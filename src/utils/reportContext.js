// Shared helpers for turning raw Document/CycleLog records into plain-text
// context blocks suitable for a Sarvam chat-completion prompt. Used by both
// the user-facing health report (reportController.js) and the AI-generated
// partner care suggestions (careSuggestionsAi.js) — kept in one place so the
// two features describe the same data to the model the same way.

const MAX_TEXT_PER_DOC = 4000;

export const DOC_TYPE_LABELS = {
  prescription: 'Prescription',
  lab_report: 'Lab Report',
  bill: 'Medical Bill',
  scan: 'Scan / Imaging',
  other: 'Other',
};

export const buildDocumentContext = (documents) =>
  documents
    .map((doc) => {
      const dateLabel = doc.documentDate.toISOString().slice(0, 10);
      const label = DOC_TYPE_LABELS[doc.docType] || 'Other';
      const body = doc.extractedText?.trim()
        ? doc.extractedText.slice(0, MAX_TEXT_PER_DOC)
        : '[No readable text could be extracted from this file]';
      return `"${doc.title}" (${label}, dated ${dateLabel}):\n${body}`;
    })
    .join('\n\n---\n\n');

export function buildCycleContext(cycle) {
  if (cycle.daysLogged === 0) return null;
  const lines = [`${cycle.daysLogged} day(s) logged, ${cycle.periodDays} of them period days.`];
  if (cycle.symptomCounts.length) {
    lines.push(
      `Top symptoms: ${cycle.symptomCounts.map((s) => `${s.label} (${s.value}x)`).join(', ')}.`,
    );
  }
  if (cycle.moodCounts.length) {
    lines.push(
      `Mood breakdown: ${cycle.moodCounts.map((m) => `${m.label} (${m.value}x)`).join(', ')}.`,
    );
  }
  if (cycle.flowCounts.length) {
    lines.push(
      `Flow breakdown: ${cycle.flowCounts.map((f) => `${f.label} (${f.value}x)`).join(', ')}.`,
    );
  }
  if (cycle.averages.sleepHours != null)
    lines.push(`Average sleep: ${cycle.averages.sleepHours} hrs/night.`);
  if (cycle.averages.waterIntake != null)
    lines.push(`Average water intake: ${cycle.averages.waterIntake} ml/day.`);
  if (cycle.averages.stressLevel != null)
    lines.push(`Average stress level: ${cycle.averages.stressLevel}/10.`);
  return lines.join('\n');
}
