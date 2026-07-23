-- 8 filas de fechas de inicio (curso x modalidad). Fecha NULL hasta que el operador la fije.
INSERT INTO fechas_inicio (curso, modalidad) VALUES
  ('Excel','entre_semana'), ('Excel','sabatino'),
  ('SQL Server','entre_semana'), ('SQL Server','sabatino'),
  ('Power BI','entre_semana'), ('Power BI','sabatino'),
  ('Python','entre_semana'), ('Python','sabatino')
ON CONFLICT (curso, modalidad) DO NOTHING;
