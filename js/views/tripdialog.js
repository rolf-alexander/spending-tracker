// The "Plan a trip" / "Edit trip" form, used by the Trips screen and the quick-add screen.

import { tripRecords } from '../store.js';
import { esc, showDialog } from '../util.js';

// Resolves with { name, start, end }, or null when cancelled.
export function tripDialog(trip) {
  const valid = d => {
    const name = d.querySelector('[name=name]').value.trim();
    const start = d.querySelector('[name=start]').value;
    const end = d.querySelector('[name=end]').value;
    const err = d.querySelector('.form-error');
    const taken = name !== trip?.name && tripRecords().some(t => t.name === name);
    err.textContent = !name ? 'Give the trip a name.'
      : start && end && start > end ? 'The trip ends before it starts.'
      : taken ? 'A trip with this name already exists.' : '';
    return !err.textContent;
  };
  return showDialog({
    title: trip ? 'Edit trip' : 'Plan a trip',
    body: `
      <label class="field">Name<input type="text" name="name" value="${esc(trip?.name || '')}" placeholder="e.g. Japan 2027" autocomplete="off"></label>
      <div class="field-row">
        <label class="field grow">From<input type="date" name="start" value="${esc(trip?.start || '')}"></label>
        <label class="field grow">To<input type="date" name="end" value="${esc(trip?.end || '')}"></label>
      </div>
      <p class="muted small">Anything you add between these dates is tagged with the trip automatically.
        For things you buy beforehand (flights, gear…), choose the trip when you add them.</p>
      <p class="form-error" role="alert"></p>`,
    buttons: [
      { label: 'Cancel', value: null, style: 'ghost' },
      { label: trip ? 'Save' : 'Create trip', value: true, style: 'primary', validate: valid },
    ],
    onOpen: d => { if (!trip) d.querySelector('[name=name]').focus(); },
    collect: d => ({
      name: d.querySelector('[name=name]').value.trim(),
      start: d.querySelector('[name=start]').value,
      end: d.querySelector('[name=end]').value,
    }),
  });
}
