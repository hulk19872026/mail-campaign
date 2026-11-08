-- Prospects: businesses we would like to win but who have never asked to hear
-- from us. They are kept apart from customers on purpose. Customers can be
-- emailed through Resend; prospects never are — cold outreach goes out from a
-- separate domain through Mailmeteor, and this table only tracks and exports
-- them. A prospect becomes a customer once they reply or sign up.
CREATE TABLE IF NOT EXISTS prospects (
  id                    SERIAL PRIMARY KEY,
  list                  TEXT NOT NULL DEFAULT 'voip',        -- voip | violations | construction
  business_name         TEXT NOT NULL DEFAULT '',
  contact_name          TEXT NOT NULL DEFAULT '',
  email                 TEXT NOT NULL DEFAULT '',
  phone                 TEXT NOT NULL DEFAULT '',
  address               TEXT NOT NULL DEFAULT '',
  category              TEXT NOT NULL DEFAULT '',
  notes                 TEXT NOT NULL DEFAULT '',
  source_url            TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'new',         -- new | contacted | follow_up | replied | meeting | quoted | won | lost | do_not_contact
  last_contacted_at     TIMESTAMPTZ,
  next_follow_up        DATE,
  converted_customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS prospects_email_key ON prospects (lower(email)) WHERE email <> '';
CREATE INDEX IF NOT EXISTS prospects_list_status_idx ON prospects (list, status);

-- First VoIP list: independent Brooklyn offices with a published email
-- (researched Nov 7, 2026). Law-firm addresses come from a lender's approved
-- attorney list dated Oct 2025, so verify before sending.
INSERT INTO prospects (list, business_name, contact_name, email, phone, address, category, notes, source_url) VALUES
 ('voip','Bay Ridge Dental','Dr. David Gutwirth','info@bayridgedental.com','718-504-6043','48 70th Street, Brooklyn, NY 11209','Dental','','https://bayridgedental.com/team/'),
 ('voip','Cosmetic Dentistry Center','','info@cosmeticdentistrycenter.com','718-491-3100','7708 4th Avenue, Brooklyn, NY 11209','Dental','Also lists dentist7708@gmail.com','https://www.cosmeticdentistrycenter.com/contacts/'),
 ('voip','Park Slope Dentistry','','parkslopedentistry@gmail.com','718-398-6300','586A President Street, Brooklyn, NY 11215','Dental','','https://parkslopedentistry.com/'),
 ('voip','Park Slope Dental Associates','Dr. Murray Fryd','info@parkslopedentalassociates.com','718-788-3290','592 5th Ave, Brooklyn, NY 11215','Dental','','https://www.parkslopedentalassociates.com/'),
 ('voip','VMC Dental','','info@vmcdental.com','646-535-9010','613 4th Avenue Suite 1, Brooklyn, NY 11215','Dental','','https://www.vmcdental.com/'),
 ('voip','Fresh Orthodontics','','hello@freshorthodontics.com','347-708-9777','385 4th Avenue Unit 2, Brooklyn, NY 11215','Dental','','https://www.freshorthodontics.com/dentist-referral-form/'),
 ('voip','Midtown Dental Group','','info@midtowndentalgroup.com','212-730-4440','300 8th Ave, Brooklyn, NY 11215','Dental','Multi-location group (Park Slope + Marine Park) - best VoIP fit','https://midtowndentalgroup.com/locations/parkslope/'),
 ('voip','Fink & Zelmanovitz, PC','Neil Fink','info@fzpclaw.com','718-377-7600','4119 Avenue T, Brooklyn, NY 11234','Law','Verify email (Oct 2025 list)','https://www.homebridgewholesale.com/wp-content/uploads/2025/10/NY-Approved-Attorney-List-10-15-25.pdf'),
 ('voip','The Stein Law Firm','Irene Stein','closings@steinesq.com','718-375-3300','4436 Bedford Ave, Brooklyn, NY 11229','Law','Verify email (Oct 2025 list)','https://www.homebridgewholesale.com/wp-content/uploads/2025/10/NY-Approved-Attorney-List-10-15-25.pdf'),
 ('voip','Law Office of Svetlana Kaplun','Svetlana Kaplun','sandra@skarplaw.com','718-444-1115','2020 Jerome Ave #1B, Brooklyn, NY 11235','Law','Verify email (Oct 2025 list)','https://www.homebridgewholesale.com/wp-content/uploads/2025/10/NY-Approved-Attorney-List-10-15-25.pdf'),
 ('voip','Volshteyn PLLC','Gabriella Volshteyn','office@volshteynlaw.com','718-332-7700','1600 Sheepshead Bay Rd Suite 2-1, Brooklyn, NY 11235','Law','Verify email (Oct 2025 list)','https://www.homebridgewholesale.com/wp-content/uploads/2025/10/NY-Approved-Attorney-List-10-15-25.pdf'),
 ('voip','Law Office of Michael Michael','Michael Michael','mhmesqny@aol.com','718-998-9888','1795 Coney Island Avenue, Brooklyn, NY 11230','Law','AOL address - likely older phone setup too','https://www.homebridgewholesale.com/wp-content/uploads/2025/10/NY-Approved-Attorney-List-10-15-25.pdf'),
 ('voip','Leonard Swerdloff & Associates','Leonard Swerdloff','leanardswerdloffesq@gmail.com','718-339-1400','925 Avenue T, Brooklyn, NY 11223','Law','Email spelling looks off - call before emailing','https://www.homebridgewholesale.com/wp-content/uploads/2025/10/NY-Approved-Attorney-List-10-15-25.pdf'),
 ('voip','RE/MAX Edge','','contact@remaxedgeny.com','718-612-3088','1812 Bath Ave, Brooklyn, NY 11214','Real estate','','https://www.zillow.com/profile/REMAX%20EDGE'),
 ('voip','Sheepshead Bay Agency','Yuri','yuri@shbagency.com','718-891-9600','3099 Emmons Avenue, Brooklyn, NY 11235','Insurance','','https://nextdoor.com/pages/sheepshead-bay-agency-brooklyn-ny-1/')
ON CONFLICT DO NOTHING;
