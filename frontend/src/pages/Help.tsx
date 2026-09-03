import { Card } from '../components/ui';

const TOPICS = [
  {
    question: 'What does 99 a day mean?',
    answer:
      'The system sends at most 99 marketing emails per calendar day. When it reaches 99 it stops and waits until the next day, then carries on from exactly where it left off. You can change the number in Settings, but keeping it low protects your sending reputation and keeps you inside your provider limits.',
  },
  {
    question: 'How do I import customers?',
    answer:
      'Two ways. Open Integrations and press "Sync customers" to pull everyone from Wave Accounting, or open Customers and press "Import CSV" to upload a spreadsheet. Only records with a valid email address are imported, and nobody is ever added twice.',
  },
  {
    question: 'How does automatic sending work?',
    answer:
      'Once you press "Start campaign", the system checks every five minutes. When it reaches your sending time, it sends emails in small batches with a pause between each one, until it hits the daily limit. The next day it picks up where it stopped, and keeps going until everyone on the list has received the campaign exactly once.',
  },
  {
    question: 'How do I stop a campaign?',
    answer:
      'Open the campaign and press "Pause campaign". Sending stops immediately; nobody who has already received it will get it again. Press "Resume campaign" whenever you are ready. "Cancel campaign" stops it for good.',
  },
  {
    question: 'How do I create a maintenance flyer?',
    answer:
      'Design it however you like — Canva, Word, whatever you already use — and export it as a PNG, JPG or PDF under 8 MB. On step 4 of the campaign wizard, upload it. Images appear inside the email; PDFs are attached and linked with a button.',
  },
  {
    question: 'What happens when someone unsubscribes?',
    answer:
      'Every email carries an unsubscribe link. One click marks that customer as unsubscribed and adds their address to your suppression list. They will never receive another marketing email, in this campaign or any future one. Their record stays in your customer list, marked "Unsubscribed".',
  },
  {
    question: 'Can I see the email before it goes out?',
    answer:
      'Yes, twice. Step 6 of the wizard shows a live preview as you edit, and the final review step shows the exact email with your subject line and sender name. You can also send a test to yourself from that screen or from any campaign page.',
  },
  {
    question: 'What if the app restarts in the middle of a campaign?',
    answer:
      'Nothing is lost. Every recipient, every sent email and the daily count live in the database, not in memory. When the app comes back it recovers anything that was mid-flight and continues. Nobody gets a duplicate.',
  },
];

export default function Help() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Help</h1>
        <p className="mt-1 text-sm text-muted">Short answers to the questions that come up most.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {TOPICS.map((topic) => (
          <Card key={topic.question}>
            <h2 className="text-base font-semibold text-white">{topic.question}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{topic.answer}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
