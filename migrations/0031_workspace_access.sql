-- AIWITH-299: member-local onboarding and explicit invitation authority.
ALTER TABLE members ADD onboarding_skipped_at integer;
ALTER TABLE invites ADD issuer_required integer NOT NULL DEFAULT 1 CHECK (issuer_required IN (0,1));
-- Only invitations that already had no issuer are grandfathered. Future SET NULL
-- after deleting a strict issuer must never turn a new token into a legacy token.
UPDATE invites SET issuer_required=0 WHERE invited_by IS NULL;
CREATE TABLE workspace_creation_requests (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'created' CHECK (state IN ('created','cancelled')),
  session_id text NOT NULL,
  workspace_id text REFERENCES workspaces(id) ON DELETE SET NULL,
  created_at integer NOT NULL,
  PRIMARY KEY(user_id,request_id)
);
CREATE UNIQUE INDEX workspace_creation_workspace_idx ON workspace_creation_requests(workspace_id);
