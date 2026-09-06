-- Numbers are stored however they were typed or imported — "212 555 0101",
-- "(212) 555-0101" — while Twilio always reports E.164, "+12125550101". Compared
-- on all their digits those are different numbers, so a STOP reply matched no
-- customer and left their consent switched on.
--
-- Compare on the last ten digits instead, which is the part that identifies a
-- North American line whether or not the country code was written down.
DROP INDEX IF EXISTS sms_suppression_phone_key;

-- Collapse any duplicates the old index allowed before the new one is built.
DELETE FROM sms_suppression_list a
 USING sms_suppression_list b
 WHERE a.id > b.id
   AND right(regexp_replace(a.phone, '[^0-9]', '', 'g'), 10)
     = right(regexp_replace(b.phone, '[^0-9]', '', 'g'), 10);

CREATE UNIQUE INDEX IF NOT EXISTS sms_suppression_phone_key
  ON sms_suppression_list (right(regexp_replace(phone, '[^0-9]', '', 'g'), 10));
