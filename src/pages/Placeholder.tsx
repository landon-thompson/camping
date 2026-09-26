import { Card, PageTitle } from '../components/ui';

export function Placeholder({ title, phase, items }: { title: string; phase: string; items: string[] }) {
  return (
    <div className="space-y-4">
      <PageTitle sub={`Coming in ${phase}`}>{title}</PageTitle>
      <Card>
        <ul className="list-disc space-y-1 pl-5 text-ink-2">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
