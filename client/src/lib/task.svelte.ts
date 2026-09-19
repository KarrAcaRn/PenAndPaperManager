/**
 * Kapselt das wiederkehrende Muster "Aktion ausführen, Fehler anzeigen, währenddessen sperren".
 * run() liefert true bei Erfolg.
 */
export function createTask() {
  let error = $state('');
  let busy = $state(false);
  return {
    get error() {
      return error;
    },
    get busy() {
      return busy;
    },
    async run(action: () => Promise<unknown>): Promise<boolean> {
      error = '';
      busy = true;
      try {
        await action();
        return true;
      } catch (err) {
        error = (err as Error).message;
        return false;
      } finally {
        busy = false;
      }
    },
  };
}
