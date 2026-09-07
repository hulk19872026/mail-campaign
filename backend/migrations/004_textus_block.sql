-- The "Text us" button is a block, so emails built before it existed do not
-- have one and cannot show it. Add one to the saved templates and to campaigns
-- that have not started sending yet.
--
-- It goes at the end of the block list: finding the right spot mid-array is not
-- something to guess at in a migration, and the button can be dragged anywhere
-- in the editor afterwards. Emails that already have one are left alone.

UPDATE email_templates
   SET blocks = blocks || jsonb_build_array(jsonb_build_object(
         'id',      'textus',
         'type',    'textus',
         'label',   'Text us',
         'message', 'Hi HULK Automation, I have a question.'
       )),
       updated_at = now()
 WHERE NOT (blocks @> '[{"type":"textus"}]'::jsonb);

-- Active and completed campaigns are deliberately excluded: the app requires a
-- campaign to be paused before its email can be edited, and a migration should
-- not rewrite an email halfway through being delivered.
UPDATE campaigns
   SET blocks = blocks || jsonb_build_array(jsonb_build_object(
         'id',      'textus',
         'type',    'textus',
         'label',   'Text us',
         'message', 'Hi HULK Automation, I have a question.'
       ))
 WHERE status IN ('draft', 'scheduled', 'paused')
   AND NOT (blocks @> '[{"type":"textus"}]'::jsonb);
