BEGIN;

-- ============================================================
-- LAMITEX PLANNING ERP
-- AUTH + APPLICATION ROLES + ROW LEVEL SECURITY
-- ============================================================


-- ============================================================
-- 1. APPLICATION ROLES
-- ============================================================

DO $$
BEGIN
    CREATE TYPE public.app_role AS ENUM (
        'ADMIN',
        'ENGINEERING',
        'PLANNER',
        'SUPERVISOR',
        'VIEWER'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;


-- ============================================================
-- 2. USER PROFILE / ROLE TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_profiles (
    user_id uuid PRIMARY KEY
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    display_name text,

    role public.app_role
        NOT NULL
        DEFAULT 'VIEWER',

    active boolean
        NOT NULL
        DEFAULT true,

    created_at timestamptz
        NOT NULL
        DEFAULT now(),

    updated_at timestamptz
        NOT NULL
        DEFAULT now()
);

ALTER TABLE public.user_profiles
ENABLE ROW LEVEL SECURITY;


-- Reuse the updated_at function already created in baseline.
DROP TRIGGER IF EXISTS trg_user_profiles_updated_at
ON public.user_profiles;

CREATE TRIGGER trg_user_profiles_updated_at
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 3. AUTOMATIC PROFILE CREATION WHEN AUTH USER IS CREATED
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN

    INSERT INTO public.user_profiles (
        user_id,
        display_name
    )
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data ->> 'full_name',
            NEW.raw_user_meta_data ->> 'name'
        )
    )
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;

END;
$$;

REVOKE ALL
ON FUNCTION public.handle_new_auth_user()
FROM PUBLIC;


DROP TRIGGER IF EXISTS on_auth_user_created
ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user();


-- ============================================================
-- 4. BACKFILL FOR USERS THAT MAY ALREADY EXIST
-- ============================================================

INSERT INTO public.user_profiles (
    user_id,
    display_name
)
SELECT
    u.id,
    COALESCE(
        u.raw_user_meta_data ->> 'full_name',
        u.raw_user_meta_data ->> 'name'
    )
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;


-- ============================================================
-- 5. SECURITY HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_profiles p
        WHERE p.user_id = auth.uid()
          AND p.active = true
    );
$$;


CREATE OR REPLACE FUNCTION public.has_any_role(
    allowed_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_profiles p
        WHERE p.user_id = auth.uid()
          AND p.active = true
          AND p.role::text = ANY (allowed_roles)
    );
$$;


REVOKE ALL
ON FUNCTION public.is_active_user()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.has_any_role(text[])
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.is_active_user()
TO authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.has_any_role(text[])
TO authenticated, service_role;


-- ============================================================
-- 6. USER PROFILES PERMISSIONS
-- ============================================================

REVOKE ALL
ON TABLE public.user_profiles
FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.user_profiles
TO authenticated;

GRANT ALL PRIVILEGES
ON TABLE public.user_profiles
TO service_role;


DROP POLICY IF EXISTS profiles_select_self_or_admin
ON public.user_profiles;

CREATE POLICY profiles_select_self_or_admin
ON public.user_profiles
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR public.has_any_role(ARRAY['ADMIN'])
);


DROP POLICY IF EXISTS profiles_admin_insert
ON public.user_profiles;

CREATE POLICY profiles_admin_insert
ON public.user_profiles
FOR INSERT
TO authenticated
WITH CHECK (
    public.has_any_role(ARRAY['ADMIN'])
);


DROP POLICY IF EXISTS profiles_admin_update
ON public.user_profiles;

CREATE POLICY profiles_admin_update
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (
    public.has_any_role(ARRAY['ADMIN'])
)
WITH CHECK (
    public.has_any_role(ARRAY['ADMIN'])
);


DROP POLICY IF EXISTS profiles_admin_delete
ON public.user_profiles;

CREATE POLICY profiles_admin_delete
ON public.user_profiles
FOR DELETE
TO authenticated
USING (
    public.has_any_role(ARRAY['ADMIN'])
);


-- ============================================================
-- 7. BASE SECURITY FOR ERP CORE TABLES
--
-- All active ERP users:
--   SELECT
--
-- ADMIN:
--   DELETE
--
-- INSERT/UPDATE depends on functional area.
-- ============================================================

DO $$
DECLARE
    t text;
BEGIN

    FOREACH t IN ARRAY ARRAY[
        'imports',
        'product_models',
        'product_skus',
        'engineering_boms',
        'engineering_bom_nodes',
        'material_families',
        'materials',
        'sap_bom_headers',
        'sap_bom_items',
        'validation_issues'
    ]
    LOOP

        EXECUTE format(
            'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
            t
        );

        EXECUTE format(
            'REVOKE ALL ON TABLE public.%I FROM anon',
            t
        );

        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
            t
        );

        EXECUTE format(
            'GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role',
            t
        );

        EXECUTE format(
            'DROP POLICY IF EXISTS erp_select_active ON public.%I',
            t
        );

        EXECUTE format(
            'CREATE POLICY erp_select_active
             ON public.%I
             FOR SELECT
             TO authenticated
             USING (public.is_active_user())',
            t
        );

        EXECUTE format(
            'DROP POLICY IF EXISTS erp_delete_admin ON public.%I',
            t
        );

        EXECUTE format(
            'CREATE POLICY erp_delete_admin
             ON public.%I
             FOR DELETE
             TO authenticated
             USING (
                 public.has_any_role(ARRAY[''ADMIN''])
             )',
            t
        );

    END LOOP;

END
$$;


-- ============================================================
-- 8. ENGINEERING MASTER DATA
--
-- ADMIN + ENGINEERING may create/update:
-- product models
-- SKUs
-- engineering BOM
-- BOM nodes
-- material families
-- materials
-- SAP BOM
-- ============================================================

DO $$
DECLARE
    t text;
BEGIN

    FOREACH t IN ARRAY ARRAY[
        'product_models',
        'product_skus',
        'engineering_boms',
        'engineering_bom_nodes',
        'material_families',
        'materials',
        'sap_bom_headers',
        'sap_bom_items'
    ]
    LOOP

        EXECUTE format(
            'DROP POLICY IF EXISTS erp_insert_engineering ON public.%I',
            t
        );

        EXECUTE format(
            'CREATE POLICY erp_insert_engineering
             ON public.%I
             FOR INSERT
             TO authenticated
             WITH CHECK (
                 public.has_any_role(
                     ARRAY[''ADMIN'', ''ENGINEERING'']
                 )
             )',
            t
        );

        EXECUTE format(
            'DROP POLICY IF EXISTS erp_update_engineering ON public.%I',
            t
        );

        EXECUTE format(
            'CREATE POLICY erp_update_engineering
             ON public.%I
             FOR UPDATE
             TO authenticated
             USING (
                 public.has_any_role(
                     ARRAY[''ADMIN'', ''ENGINEERING'']
                 )
             )
             WITH CHECK (
                 public.has_any_role(
                     ARRAY[''ADMIN'', ''ENGINEERING'']
                 )
             )',
            t
        );

    END LOOP;

END
$$;


-- ============================================================
-- 9. IMPORT CONTROL
--
-- ADMIN + ENGINEERING + PLANNER
-- ============================================================

DROP POLICY IF EXISTS erp_insert_imports
ON public.imports;

CREATE POLICY erp_insert_imports
ON public.imports
FOR INSERT
TO authenticated
WITH CHECK (
    public.has_any_role(
        ARRAY[
            'ADMIN',
            'ENGINEERING',
            'PLANNER'
        ]
    )
);


DROP POLICY IF EXISTS erp_update_imports
ON public.imports;

CREATE POLICY erp_update_imports
ON public.imports
FOR UPDATE
TO authenticated
USING (
    public.has_any_role(
        ARRAY[
            'ADMIN',
            'ENGINEERING',
            'PLANNER'
        ]
    )
)
WITH CHECK (
    public.has_any_role(
        ARRAY[
            'ADMIN',
            'ENGINEERING',
            'PLANNER'
        ]
    )
);


-- ============================================================
-- 10. DATA VALIDATION
--
-- ADMIN
-- ENGINEERING
-- PLANNER
-- SUPERVISOR
-- ============================================================

DROP POLICY IF EXISTS erp_insert_validation
ON public.validation_issues;

CREATE POLICY erp_insert_validation
ON public.validation_issues
FOR INSERT
TO authenticated
WITH CHECK (
    public.has_any_role(
        ARRAY[
            'ADMIN',
            'ENGINEERING',
            'PLANNER',
            'SUPERVISOR'
        ]
    )
);


DROP POLICY IF EXISTS erp_update_validation
ON public.validation_issues;

CREATE POLICY erp_update_validation
ON public.validation_issues
FOR UPDATE
TO authenticated
USING (
    public.has_any_role(
        ARRAY[
            'ADMIN',
            'ENGINEERING',
            'PLANNER',
            'SUPERVISOR'
        ]
    )
)
WITH CHECK (
    public.has_any_role(
        ARRAY[
            'ADMIN',
            'ENGINEERING',
            'PLANNER',
            'SUPERVISOR'
        ]
    )
);


COMMIT;