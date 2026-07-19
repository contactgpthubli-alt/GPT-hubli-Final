-- Study Certificate + Studying Certificate (ACM) — same pattern as TC

-- Reuse tc_templates with scopes: study | studying
INSERT INTO tc_templates (scope, labels, header, footer)
VALUES (
  'study',
  '{
    "title_en": "STUDY CERTIFICATE",
    "title_kn": "ಅಧ್ಯಯನ ಪ್ರಮಾಣಪತ್ರ",
    "cert_no_label_en": "Certificate No.",
    "cert_no_label_kn": "ಪ್ರಮಾಣಪತ್ರ ಸಂಖ್ಯೆ",
    "body_prefix_en": "This is to certify that",
    "body_prefix_kn": "ಇದು ಪ್ರಮಾಣೀಕರಿಸುತ್ತದೆ",
    "son_daughter_en": "S/o / D/o",
    "son_daughter_kn": "ಮಗ / ಮಗಳು",
    "reg_label_en": "bearing Register No.",
    "reg_label_kn": "ನೋಂದಣಿ ಸಂಖ್ಯೆ",
    "was_student_en": "was a bonafide student of this institution and has studied the Diploma course in",
    "was_student_kn": "ಈ ಸಂಸ್ಥೆಯಲ್ಲಿ ಡಿಪ್ಲೊಮಾ ಕೋರ್ಸ್ ಅಧ್ಯಯನ ಮಾಡಿದ್ದಾರೆ",
    "during_en": "during the academic year(s)",
    "during_kn": "ಶೈಕ್ಷಣಿಕ ವರ್ಷ(ಗಳು)",
    "to_en": "to",
    "character_en": "His / Her character and conduct during the period of study was",
    "character_kn": "ಅಧ್ಯಯನ ಅವಧಿಯಲ್ಲಿ ಅವರ ನಡವಳಿಕೆ",
    "purpose_en": "This certificate is issued on his/her request for the purpose of",
    "purpose_kn": "ಈ ಪ್ರಮಾಣಪತ್ರವನ್ನು ಕೆಳಕಂಡ ಉದ್ದೇಶಕ್ಕಾಗಿ ನೀಡಲಾಗಿದೆ",
    "records_en": "The above particulars are true and correct as per the records of this institution.",
    "records_kn": "ಮೇಲಿನ ವಿವರಗಳು ಸಂಸ್ಥೆಯ ದಾಖಲೆಗಳ ಪ್ರಕಾರ ಸರಿಯಾಗಿವೆ."
  }'::jsonb,
  '{
    "govt_en": "GOVERNMENT OF KARNATAKA",
    "govt_kn": "ಕರ್ನಾಟಕ ಸರ್ಕಾರ",
    "dept_en": "Department of Technical Education",
    "dept_kn": "ತಾಂತ್ರಿಕ ಶಿಕ್ಷಣ ಇಲಾಖೆ",
    "college_en": "GOVERNMENT POLYTECHNIC, HUBBALLI",
    "college_kn": "ಸರ್ಕಾರಿ ಪಾಲಿಟೆಕ್ನಿಕ್, ಹುಬ್ಬಳ್ಳಿ",
    "emblem_url": "/karnataka-emblem.png"
  }'::jsonb,
  '{
    "place_en": "Place: Hubballi",
    "place_kn": "ಸ್ಥಳ: ಹುಬ್ಬಳ್ಳಿ",
    "sign_right_en": "Principal",
    "sign_right_kn": "ಪ್ರಾಂಶುಪಾಲರು",
    "note_en": "This certificate is issued on the request of the student.",
    "note_kn": "ಈ ಪ್ರಮಾಣಪತ್ರವನ್ನು ವಿದ್ಯಾರ್ಥಿಯ ಕೋರಿಕೆಯ ಮೇರೆಗೆ ನೀಡಲಾಗಿದೆ."
  }'::jsonb
)
ON CONFLICT (scope) DO NOTHING;

INSERT INTO tc_templates (scope, labels, header, footer)
VALUES (
  'studying',
  '{
    "title_en": "STUDYING CERTIFICATE",
    "title_kn": "ಅಧ್ಯಯನ ಮಾಡುತ್ತಿರುವ ಪ್ರಮಾಣಪತ್ರ",
    "cert_no_label_en": "Certificate No.",
    "cert_no_label_kn": "ಪ್ರಮಾಣಪತ್ರ ಸಂಖ್ಯೆ",
    "body_prefix_en": "This is to certify that",
    "body_prefix_kn": "ಇದು ಪ್ರಮಾಣೀಕರಿಸುತ್ತದೆ",
    "son_daughter_en": "S/o / D/o",
    "son_daughter_kn": "ಮಗ / ಮಗಳು",
    "reg_label_en": "bearing Register No.",
    "reg_label_kn": "ನೋಂದಣಿ ಸಂಖ್ಯೆ",
    "is_student_en": "is a bonafide student of this institution presently studying in",
    "is_student_kn": "ಈ ಸಂಸ್ಥೆಯಲ್ಲಿ ಪ್ರಸ್ತುತ ಅಧ್ಯಯನ ಮಾಡುತ್ತಿದ್ದಾರೆ",
    "of_diploma_en": "of the Diploma course in",
    "of_diploma_kn": "ಡಿಪ್ಲೊಮಾ ಕೋರ್ಸ್",
    "academic_year_en": "during the academic year",
    "academic_year_kn": "ಶೈಕ್ಷಣಿಕ ವರ್ಷ",
    "character_en": "His / Her character and conduct is",
    "character_kn": "ಅವರ ನಡವಳಿಕೆ",
    "purpose_en": "This certificate is issued on his/her request for the purpose of",
    "purpose_kn": "ಈ ಪ್ರಮಾಣಪತ್ರವನ್ನು ಕೆಳಕಂಡ ಉದ್ದೇಶಕ್ಕಾಗಿ ನೀಡಲಾಗಿದೆ",
    "records_en": "The above particulars are true and correct as per the records of this institution.",
    "records_kn": "ಮೇಲಿನ ವಿವರಗಳು ಸಂಸ್ಥೆಯ ದಾಖಲೆಗಳ ಪ್ರಕಾರ ಸರಿಯಾಗಿವೆ."
  }'::jsonb,
  '{
    "govt_en": "GOVERNMENT OF KARNATAKA",
    "govt_kn": "ಕರ್ನಾಟಕ ಸರ್ಕಾರ",
    "dept_en": "Department of Technical Education",
    "dept_kn": "ತಾಂತ್ರಿಕ ಶಿಕ್ಷಣ ಇಲಾಖೆ",
    "college_en": "GOVERNMENT POLYTECHNIC, HUBBALLI",
    "college_kn": "ಸರ್ಕಾರಿ ಪಾಲಿಟೆಕ್ನಿಕ್, ಹುಬ್ಬಳ್ಳಿ",
    "emblem_url": "/karnataka-emblem.png"
  }'::jsonb,
  '{
    "place_en": "Place: Hubballi",
    "place_kn": "ಸ್ಥಳ: ಹುಬ್ಬಳ್ಳಿ",
    "sign_right_en": "Principal",
    "sign_right_kn": "ಪ್ರಾಂಶುಪಾಲರು",
    "note_en": "This certificate is issued on the request of the student.",
    "note_kn": "ಈ ಪ್ರಮಾಣಪತ್ರವನ್ನು ವಿದ್ಯಾರ್ಥಿಯ ಕೋರಿಕೆಯ ಮೇರೆಗೆ ನೀಡಲಾಗಿದೆ."
  }'::jsonb
)
ON CONFLICT (scope) DO NOTHING;

CREATE TABLE IF NOT EXISTS acm_cert_register (
  id                    BIGSERIAL PRIMARY KEY,
  cert_kind             TEXT NOT NULL, -- study | studying
  cert_no               TEXT NOT NULL,
  reg_no                TEXT NOT NULL,
  student_name          TEXT NOT NULL DEFAULT '',
  father_name           TEXT NOT NULL DEFAULT '',
  mother_name           TEXT NOT NULL DEFAULT '',
  branch                TEXT NOT NULL DEFAULT '',
  form_data             JSONB NOT NULL DEFAULT '{}'::jsonb,
  cert_request_id       BIGINT REFERENCES cert_requests(id) ON DELETE SET NULL,
  printed_at            TIMESTAMPTZ,
  printed_by            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  sent_to_college       TEXT NOT NULL DEFAULT '',
  sent_date             TEXT NOT NULL DEFAULT '',
  post_office_receipt   TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'draft',
  remarks               TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acm_cert_reg_kind ON acm_cert_register(cert_kind, status);
CREATE INDEX IF NOT EXISTS idx_acm_cert_reg_no ON acm_cert_register(reg_no);
CREATE INDEX IF NOT EXISTS idx_acm_cert_cert_no ON acm_cert_register(cert_no);
