import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import FrameSizePicker from '../src/lib/FrameSizePicker.svelte';

describe('Rahmengröße (Test-Auswahl)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty('--vine-width');
  });

  const select = () => screen.getByLabelText(/Rahmengröße/) as HTMLSelectElement;
  const width = () => document.documentElement.style.getPropertyValue('--vine-width');

  it('setzt die gewählte Größe als --vine-width und merkt sie sich', async () => {
    const first = render(FrameSizePicker);
    await Promise.resolve();
    expect(width()).toBe('44px');
    expect([...select().options].map((o) => o.textContent)).toEqual(['70 %', '75 %', '80 %', '85 %', '90 %', '95 %', '100 %']);
    await userEvent.setup().selectOptions(select(), '75');
    expect(width()).toBe('33px');
    first.unmount();

    render(FrameSizePicker);
    expect(select().value).toBe('75');
  });

  it('ignoriert unbekannte gespeicherte Werte', () => {
    localStorage.setItem('pnp-frame-size', '42');
    render(FrameSizePicker);
    expect(select().value).toBe('100');
  });
});
