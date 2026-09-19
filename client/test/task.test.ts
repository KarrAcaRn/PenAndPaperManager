import { describe, expect, it } from 'vitest';
import { createTask } from '../src/lib/task.svelte.ts';

describe('createTask', () => {
  it('meldet Erfolg und ist währenddessen busy', async () => {
    const task = createTask();
    let release!: () => void;
    const running = task.run(() => new Promise<void>((resolve) => (release = resolve)));
    expect(task.busy).toBe(true);
    release();
    expect(await running).toBe(true);
    expect(task).toMatchObject({ busy: false, error: '' });
  });

  it('fängt Fehler ab und setzt sie beim nächsten Lauf zurück', async () => {
    const task = createTask();
    expect(await task.run(async () => Promise.reject(new Error('kaputt')))).toBe(false);
    expect(task).toMatchObject({ busy: false, error: 'kaputt' });
    await task.run(async () => {});
    expect(task.error).toBe('');
  });
});
