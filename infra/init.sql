-- Code Quality Swarm - Database Schema
-- PostgreSQL 16+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- === Tables ===

-- Scans: Représente une session de scan complète
CREATE TABLE scans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_name VARCHAR(255) NOT NULL,
  trigger_type VARCHAR(50) NOT NULL CHECK (trigger_type IN ('schedule', 'manual', 'pr', 'commit')),
  git_branch VARCHAR(255),
  git_commit_sha VARCHAR(40),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),

  -- Résultats agrégés
  tests_generated INT DEFAULT 0,
  tests_passed INT,
  tests_failed INT,
  coverage_total DECIMAL(5,2),

  bugs_critical INT DEFAULT 0,
  bugs_high INT DEFAULT 0,
  bugs_medium INT DEFAULT 0,
  bugs_low INT DEFAULT 0,

  code_quality_score DECIMAL(5,2), -- 0-100

  -- Décision finale
  final_decision VARCHAR(20) CHECK (final_decision IN ('APPROVED', 'BLOCKED', 'WARNING', 'PENDING')),
  decision_reason TEXT,

  -- Métadonnées
  duration_seconds INT,
  cost_usd DECIMAL(10,4),  -- Coût API

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index pour requêtes fréquentes
CREATE INDEX idx_scans_project_date ON scans(project_name, started_at DESC);
CREATE INDEX idx_scans_status ON scans(status) WHERE status = 'running';
CREATE INDEX idx_scans_decision ON scans(final_decision);

-- Agent Results: Résultats détaillés par agent
CREATE TABLE agent_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  agent_name VARCHAR(50) NOT NULL CHECK (agent_name IN ('test-generator', 'code-reviewer', 'bug-detector')),

  -- Résultats spécifiques à l'agent (JSON)
  results JSONB NOT NULL,

  -- Métriques
  files_analyzed INT DEFAULT 0,
  issues_found INT DEFAULT 0,
  auto_fixes_applied INT DEFAULT 0,

  -- Performance
  duration_seconds INT,
  tokens_input INT,
  tokens_output INT,
  cost_usd DECIMAL(10,4),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_agent_results_scan ON agent_results(scan_id);
CREATE INDEX idx_agent_results_agent ON agent_results(agent_name);

-- Generated Tests: Tests générés par l'agent test-generator
CREATE TABLE generated_tests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  source_file VARCHAR(500) NOT NULL,
  test_file VARCHAR(500) NOT NULL,

  -- Contenu
  test_code TEXT NOT NULL,
  test_count INT DEFAULT 1,

  -- Validation
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'failed')),
  validation_result JSONB,  -- Résultats d'exécution du test

  -- Métadonnées
  applied_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_generated_tests_scan ON generated_tests(scan_id);
CREATE INDEX idx_generated_tests_status ON generated_tests(status);
CREATE INDEX idx_generated_tests_source ON generated_tests(source_file);

-- Code Issues: Problèmes détectés par code-reviewer et bug-detector
CREATE TABLE code_issues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  agent_name VARCHAR(50) NOT NULL,

  -- Localisation
  file_path VARCHAR(500) NOT NULL,
  line_number INT,
  column_number INT,

  -- Issue
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  category VARCHAR(50) NOT NULL, -- 'security', 'performance', 'maintainability', 'bug'
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,

  -- Suggestion
  suggestion TEXT,
  auto_fixable BOOLEAN DEFAULT false,
  fix_applied BOOLEAN DEFAULT false,
  fix_code TEXT,

  -- Métadonnées
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_code_issues_scan ON code_issues(scan_id);
CREATE INDEX idx_code_issues_severity ON code_issues(severity);
CREATE INDEX idx_code_issues_file ON code_issues(file_path);
CREATE INDEX idx_code_issues_auto_fixable ON code_issues(auto_fixable) WHERE auto_fixable = true;

-- Notifications: Historique des notifications envoyées
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,

  channel VARCHAR(50) NOT NULL CHECK (channel IN ('slack', 'discord', 'email', 'github_comment')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('sent', 'failed', 'pending')),

  payload JSONB,
  response JSONB,

  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_notifications_scan ON notifications(scan_id);
CREATE INDEX idx_notifications_status ON notifications(status) WHERE status = 'pending';

-- === Views ===

-- Vue: Statistiques par projet
CREATE VIEW project_stats AS
SELECT
  project_name,
  COUNT(*) as total_scans,
  COUNT(*) FILTER (WHERE final_decision = 'APPROVED') as scans_approved,
  COUNT(*) FILTER (WHERE final_decision = 'BLOCKED') as scans_blocked,
  AVG(code_quality_score) as avg_quality_score,
  AVG(coverage_total) as avg_coverage,
  SUM(tests_generated) as total_tests_generated,
  SUM(bugs_critical) as total_bugs_critical,
  SUM(cost_usd) as total_cost_usd
FROM scans
WHERE status = 'completed'
GROUP BY project_name;

-- Vue: Scans récents
CREATE VIEW recent_scans AS
SELECT
  s.id,
  s.project_name,
  s.trigger_type,
  s.started_at,
  s.status,
  s.final_decision,
  s.code_quality_score,
  s.coverage_total,
  s.bugs_critical + s.bugs_high as critical_issues,
  s.cost_usd
FROM scans s
ORDER BY s.started_at DESC
LIMIT 50;

-- Vue: Issues non résolues par projet
CREATE VIEW unresolved_issues AS
SELECT
  s.project_name,
  ci.severity,
  ci.category,
  COUNT(*) as issue_count,
  COUNT(*) FILTER (WHERE ci.auto_fixable = true) as auto_fixable_count
FROM code_issues ci
JOIN scans s ON ci.scan_id = s.id
WHERE ci.fix_applied = false
  AND s.status = 'completed'
GROUP BY s.project_name, ci.severity, ci.category
ORDER BY
  s.project_name,
  CASE ci.severity
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    WHEN 'low' THEN 4
    ELSE 5
  END;

-- === Functions ===

-- Fonction: Mise à jour automatique du timestamp updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour scans.updated_at
CREATE TRIGGER update_scans_updated_at
BEFORE UPDATE ON scans
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Fonction: Calculer le score de qualité
CREATE OR REPLACE FUNCTION calculate_quality_score(scan_uuid UUID)
RETURNS DECIMAL AS $$
DECLARE
  score DECIMAL(5,2);
  coverage DECIMAL(5,2);
  bugs_weight DECIMAL;
  complexity_avg DECIMAL;
BEGIN
  -- Récupérer coverage
  SELECT coverage_total INTO coverage FROM scans WHERE id = scan_uuid;

  -- Score de base sur coverage (0-40 points)
  score := COALESCE(coverage * 0.4, 0);

  -- Pénalités bugs (-10 critical, -5 high, -2 medium)
  SELECT
    (bugs_critical * 10 + bugs_high * 5 + bugs_medium * 2)
  INTO bugs_weight
  FROM scans WHERE id = scan_uuid;

  score := score - COALESCE(bugs_weight, 0);

  -- Bonus: tests générés (+1 point par test, max 20)
  score := score + LEAST(
    (SELECT COALESCE(SUM(test_count), 0) FROM generated_tests WHERE scan_id = scan_uuid),
    20
  );

  -- Limite 0-100
  score := GREATEST(0, LEAST(100, score));

  RETURN score;
END;
$$ LANGUAGE plpgsql;

-- === Données initiales ===

-- Aucune donnée initiale nécessaire

-- === Grants (sécurité) ===

-- Utilisateur swarm a tous les droits sur son schéma
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO swarm;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO swarm;

-- === Commentaires ===

COMMENT ON TABLE scans IS 'Sessions de scan complètes par projet';
COMMENT ON TABLE agent_results IS 'Résultats détaillés par agent pour chaque scan';
COMMENT ON TABLE generated_tests IS 'Tests générés automatiquement par test-generator';
COMMENT ON TABLE code_issues IS 'Problèmes de code détectés par code-reviewer et bug-detector';
COMMENT ON TABLE notifications IS 'Historique des notifications envoyées';

COMMENT ON VIEW project_stats IS 'Statistiques agrégées par projet';
COMMENT ON VIEW recent_scans IS '50 scans les plus récents';
COMMENT ON VIEW unresolved_issues IS 'Issues non résolues regroupées par projet et sévérité';
