-- A ready-made campaign for permanent exterior lighting.
--
-- seedTemplates() only plants the starter templates when the table is empty, so
-- an installation that already has templates would never see a new one. Insert
-- it here instead, skipping it if a template of this name is already present.

INSERT INTO email_templates (name, description, subject, blocks, is_system)
SELECT 'Permanent lighting',
       'Promotes permanent exterior lighting, with the flyer leading and a free-quote call to action.',
       'Permanent lighting, installed once and lit all year',
       '[{"id": "logo", "type": "logo"}, {"id": "flyer", "type": "flyer", "caption": "Permanent lighting \u2014 professionally installed"}, {"id": "headline", "type": "headline", "text": "One install. Every holiday, every season."}, {"id": "intro", "type": "paragraph", "text": "Hi {{first_name}},\n\nPermanent lighting mounts once, tucked under the eaves where you barely see it in daylight. After that it is a phone app: clean white for everyday, your team''s colors on game day, red and green in December. No ladders, no tangled strings, nothing to take down in January.\n\nIt is low-voltage work, installed and warrantied by the same crew that looks after your security and network systems. We fit homes, multi-family properties, businesses and outdoor spaces."}, {"id": "cta", "type": "button", "label": "Get a free quote", "url": "https://hulkautomation.com", "interest": "Permanent lighting"}, {"id": "textus", "type": "textus", "label": "Text us", "message": "Hi HULK Automation, I would like a quote for permanent lighting."}, {"id": "close", "type": "paragraph", "text": "Want a price? Reply to this email or tap Text us above and we will put a free quote together for you \u2014 including how it looks on your building, not just a number."}]'::jsonb,
       true
 WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'Permanent lighting');
