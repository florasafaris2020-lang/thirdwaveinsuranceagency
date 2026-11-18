CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_at TEXT,
    review_notes TEXT,
    insured_name TEXT NOT NULL,
    coverage_type TEXT NOT NULL,
    certificate_type TEXT NOT NULL,
    vehicle_number TEXT NOT NULL,
    chassis_number TEXT NOT NULL,
    vehicle_make TEXT NOT NULL,
    vehicle_model TEXT NOT NULL,
    body_type TEXT NOT NULL,
    year_of_manufacture INTEGER NOT NULL,
    engine_number TEXT NOT NULL,
    insured_pin TEXT NOT NULL,
    sum_insured REAL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    email TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    document_key TEXT NOT NULL,
    document_name TEXT NOT NULL,
    document_type TEXT NOT NULL,
    document_size INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS applications_status_created
ON applications(status, created_at DESC);
