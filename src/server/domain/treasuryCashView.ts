// This view is opt-in. Existing integrations keep the original append-only ledger.
export const EFFECTIVE_CASH_CTE = `WITH current_entries AS (
  SELECT e.*,
    COALESCE(c.amount_units,e.amount_units) AS shown_amount,
    COALESCE(c.direction,e.direction) AS shown_direction,
    COALESCE(c.description,e.description) AS shown_description,
    c.revision AS correction_revision,c.direction AS corrected_direction,c.amount_units AS corrected_amount,
    c.description AS corrected_description,c.reason AS correction_reason,c.created_at AS corrected_at,
    reviewer.display_name AS corrected_by
  FROM treasury_cash_entries e
  LEFT JOIN treasury_cash_corrections c ON c.organization_id=e.organization_id AND c.entry_id=e.id
    AND c.revision=(SELECT MAX(latest.revision) FROM treasury_cash_corrections latest
      WHERE latest.organization_id=e.organization_id AND latest.entry_id=e.id)
  LEFT JOIN users reviewer ON reviewer.id=c.actor_user_id
  WHERE e.organization_id=? AND NOT EXISTS(
    SELECT 1 FROM treasury_cash_corrections adjustment WHERE adjustment.adjustment_entry_id=e.id)
)`;
