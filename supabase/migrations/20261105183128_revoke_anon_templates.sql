/*
# Fix message_templates: remove anon access

The message_templates table was granted CRUD to both anon and authenticated,
but this app requires sign-in. The anon role should not have any access.

## Changes
- Revoke all privileges from anon on message_templates.
- authenticated retains CRUD (unchanged).
- Policies unchanged (already authenticated-only).
*/

REVOKE ALL ON message_templates FROM anon;
