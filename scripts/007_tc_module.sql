-- Transfer Certificate module: bilingual template + official register

CREATE TABLE IF NOT EXISTS tc_templates (
  id           BIGSERIAL PRIMARY KEY,
  scope        TEXT NOT NULL DEFAULT 'default',
  labels       JSONB NOT NULL DEFAULT '{}'::jsonb,
  header       JSONB NOT NULL DEFAULT '{}'::jsonb,
  footer       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope)
);

CREATE TABLE IF NOT EXISTS tc_register (
  id                    BIGSERIAL PRIMARY KEY,
  tc_no                 TEXT NOT NULL,
  admission_reg_no      TEXT NOT NULL DEFAULT '',
  reg_no                TEXT NOT NULL,
  student_name          TEXT NOT NULL DEFAULT '',
  father_name           TEXT NOT NULL DEFAULT '',
  mother_name           TEXT NOT NULL DEFAULT '',
  branch                TEXT NOT NULL DEFAULT '',
  form_data             JSONB NOT NULL DEFAULT '{}'::jsonb,
  cert_request_id       BIGINT REFERENCES cert_requests(id) ON DELETE SET NULL,
  printed_at            TIMESTAMPTZ,
  printed_by            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  tc_sent               TEXT NOT NULL DEFAULT '',
  post_office_receipt   TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'draft',
  -- draft | printed_pending | completed
  remarks               TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tc_register_reg ON tc_register(reg_no);
CREATE INDEX IF NOT EXISTS idx_tc_register_status ON tc_register(status);
CREATE INDEX IF NOT EXISTS idx_tc_register_tc_no ON tc_register(tc_no);

-- Seed default bilingual template (Admin can edit Kannada later)
INSERT INTO tc_templates (scope, labels, header, footer)
VALUES (
  'default',
  '{
    "row1": {"en": "Name of the Student", "kn": "ವಿದ್ಯಾರ್ಥಿಯ ಹೆಸರು"},
    "row2_father": {"en": "Name of the Father", "kn": "ತಂದೆಯ ಹೆಸರು"},
    "row2_mother": {"en": "Name of the Mother", "kn": "ತಾಯಿಯ ಹೆಸರು"},
    "row3": {"en": "Date of Birth (in figures and words)", "kn": "ಜನ್ಮ ದಿನಾಂಕ (ಅಂಕಿ ಮತ್ತು ಅಕ್ಷರಗಳಲ್ಲಿ)"},
    "row4_adm": {"en": "Date of Admission / 1st Year Fee Receipt Date", "kn": "ಪ್ರವೇಶ ದಿನಾಂಕ / 1ನೇ ವರ್ಷ ಶುಲ್ಕ ರಸೀದಿ ದಿನಾಂಕ"},
    "row4_reg": {"en": "Register Number", "kn": "ನೋಂದಣಿ ಸಂಖ್ಯೆ"},
    "row5": {"en": "Date of Leaving the Institution", "kn": "ಸಂಸ್ಥೆಯನ್ನು ತೊರೆದ ದಿನಾಂಕ"},
    "row6": {"en": "Class in which studying at the time of leaving", "kn": "ತೊರೆಯುವ ಸಮಯದಲ್ಲಿ ಓದುತ್ತಿದ್ದ ತರಗತಿ"},
    "row7": {"en": "Class / Semester last studied", "kn": "ಕೊನೆಯದಾಗಿ ಓದಿದ ತರಗತಿ / ಸೆಮಿಸ್ಟರ್"},
    "row8": {"en": "Whether qualified for promotion to higher class", "kn": "ಮುಂದಿನ ತರಗತಿಗೆ ಬಡ್ತಿಗೆ ಅರ್ಹರೇ"},
    "row9": {"en": "Whether the student has paid all dues to the Institution", "kn": "ಸಂಸ್ಥೆಗೆ ಬಾಕಿ ಇಲ್ಲದಂತೆ ಎಲ್ಲಾ ಶುಲ್ಕ ಪಾವತಿಸಿದ್ದಾರೆಯೇ"},
    "row10": {"en": "Whether the student was in receipt of any scholarship", "kn": "ಯಾವುದೇ ವಿದ್ಯಾರ್ಥಿವೇತನ ಪಡೆಯುತ್ತಿದ್ದರೇ"},
    "row11": {"en": "Conduct / Character", "kn": "ನಡವಳಿಕೆ / ಚಾರಿತ್ರ್ಯ"},
    "row12_religion": {"en": "Religion", "kn": "ಧರ್ಮ"},
    "row12_caste": {"en": "Caste", "kn": "ಜಾತಿ"}
  }'::jsonb,
  '{
    "govt_en": "GOVERNMENT OF KARNATAKA",
    "govt_kn": "ಕರ್ನಾಟಕ ಸರ್ಕಾರ",
    "dept_en": "Department of Technical Education",
    "dept_kn": "ತಾಂತ್ರಿಕ ಶಿಕ್ಷಣ ಇಲಾಖೆ",
    "college_en": "GOVERNMENT POLYTECHNIC, HUBBALLI",
    "college_kn": "ಸರ್ಕಾರಿ ಪಾಲಿಟೆಕ್ನಿಕ್, ಹುಬ್ಬಳ್ಳಿ",
    "title_en": "TRANSFER CERTIFICATE",
    "title_kn": "ವರ್ಗಾವಣೆ ಪ್ರಮಾಣಪತ್ರ",
    "adm_reg_label_en": "Admission Register No.",
    "adm_reg_label_kn": "ಪ್ರವೇಶ ನೋಂದಣಿ ಸಂಖ್ಯೆ",
    "tc_no_label_en": "Transfer Certificate No.",
    "tc_no_label_kn": "ವರ್ಗಾವಣೆ ಪ್ರಮಾಣಪತ್ರ ಸಂಖ್ಯೆ",
    "emblem_url": "/karnataka-emblem.png"
  }'::jsonb,
  '{
    "place_en": "Place: Hubballi",
    "place_kn": "ಸ್ಥಳ: ಹುಬ್ಬಳ್ಳಿ",
    "sign_left_en": "Clerk / ACM Section",
    "sign_left_kn": "ಗುಮಾಸ್ತ / ACM ವಿಭಾಗ",
    "sign_right_en": "Principal",
    "sign_right_kn": "ಪ್ರಾಂಶುಪಾಲರು",
    "note_en": "This certificate is issued on the request of the student.",
    "note_kn": "ಈ ಪ್ರಮಾಣಪತ್ರವನ್ನು ವಿದ್ಯಾರ್ಥಿಯ ಕೋರಿಕೆಯ ಮೇರೆಗೆ ನೀಡಲಾಗಿದೆ."
  }'::jsonb
)
ON CONFLICT (scope) DO NOTHING;
