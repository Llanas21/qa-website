-- 8 cohortes iniciales (curso x modalidad). fecha_inicio NULL hasta que el
-- operador la fije desde /admin/cohortes; cupo_maximo usa el default (10).
INSERT INTO cohortes (curso, modalidad) VALUES
  ('Excel','entre_semana'), ('Excel','sabatino'),
  ('SQL Server','entre_semana'), ('SQL Server','sabatino'),
  ('Power BI','entre_semana'), ('Power BI','sabatino'),
  ('Python','entre_semana'), ('Python','sabatino')
ON CONFLICT (curso, modalidad) WHERE fecha_inicio IS NULL DO NOTHING;
