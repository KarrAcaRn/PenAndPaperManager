import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import FrameVariantPicker from '../src/lib/FrameVariantPicker.svelte';

describe('Rahmen-Variante (Test-Auswahl)', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.frame;
  });

  it('setzt die gewählte Variante an <html> und merkt sie sich', async () => {
    const first = render(FrameVariantPicker);
    await Promise.resolve();
    expect(document.documentElement.dataset.frame).toBe('zweige');
    await userEvent.setup().selectOptions(screen.getByLabelText(/Rahmen/), 'knorrig');
    expect(document.documentElement.dataset.frame).toBe('knorrig');
    first.unmount();

    render(FrameVariantPicker);
    expect((screen.getByLabelText(/Rahmen/) as HTMLSelectElement).value).toBe('knorrig');
  });

  it('ignoriert unbekannte gespeicherte Werte', () => {
    localStorage.setItem('pnp-frame-variant', 'gibtsnicht');
    render(FrameVariantPicker);
    expect((screen.getByLabelText(/Rahmen/) as HTMLSelectElement).value).toBe('zweige');
  });
});
