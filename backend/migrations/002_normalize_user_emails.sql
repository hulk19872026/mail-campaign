-- Sign-in looks accounts up by a trimmed, lowercased address. An address stored
-- with stray whitespace — easy to get from pasting ADMIN_EMAIL into a hosting
-- dashboard — could therefore never be matched, and sign-in reported it as
-- "That email and password don't match an account."
--
-- Normalize what is already stored. Rows that would collide with another
-- account once normalized are left alone: the unique index would reject them,
-- and silently merging two accounts is not this migration's call.
UPDATE users u
   SET email = lower(btrim(u.email))
 WHERE u.email <> lower(btrim(u.email))
   AND NOT EXISTS (
     SELECT 1 FROM users other
      WHERE other.id <> u.id
        AND lower(btrim(other.email)) = lower(btrim(u.email))
   );
