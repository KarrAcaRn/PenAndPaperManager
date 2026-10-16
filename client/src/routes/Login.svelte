<script lang="ts">
  import { LOGIN_CODE_LENGTH, MAX_EMAIL_LENGTH } from '@pnp/shared';
  import { ApiFailure, api } from '../lib/api.ts';
  import { verifyLoginCode } from '../lib/session.svelte.ts';

  /** Sekunden, bis ein neuer Code angefordert werden kann */
  const RESEND_COOLDOWN = 60;
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const INVALID_EMAIL = 'Bitte gib eine gültige E-Mail-Adresse ein.';

  let step = $state<'email' | 'code'>('email');
  let email = $state('');
  let code = $state('');
  let error = $state('');
  let info = $state('');
  let busy = $state(false);
  let cooldown = $state(0);

  // Countdown für "Code erneut senden"
  $effect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => (cooldown -= 1), 1000);
    return () => clearTimeout(timer);
  });

  function describe(err: unknown): string {
    if (err instanceof ApiFailure) {
      if (err.status === 429) return 'Zu viele Anfragen. Bitte warte einen Moment und versuche es dann erneut.';
      if (step === 'code' && (err.status === 400 || err.status === 401)) return 'Code ungültig oder abgelaufen.';
      if (step === 'email' && err.status === 400) return INVALID_EMAIL;
    }
    return (err as Error).message;
  }

  async function run(action: () => Promise<void>): Promise<void> {
    error = '';
    info = '';
    busy = true;
    try {
      await action();
    } catch (err) {
      error = describe(err);
    } finally {
      busy = false;
    }
  }

  function sendCode(event: SubmitEvent) {
    event.preventDefault();
    email = email.trim();
    if (!EMAIL_PATTERN.test(email)) {
      error = INVALID_EMAIL;
      return;
    }
    run(async () => {
      await api.requestCode(email);
      code = '';
      step = 'code';
      cooldown = RESEND_COOLDOWN;
    });
  }

  function resend() {
    run(async () => {
      await api.requestCode(email);
      cooldown = RESEND_COOLDOWN;
      info = 'Ein neuer Code ist unterwegs.';
    });
  }

  function verify(event: SubmitEvent) {
    event.preventDefault();
    if (code.length !== LOGIN_CODE_LENGTH) {
      error = `Der Code besteht aus ${LOGIN_CODE_LENGTH} Ziffern.`;
      return;
    }
    // Die Weiterleitung zur ursprünglich angefragten Seite übernimmt App.svelte, sobald die Session steht.
    run(() => verifyLoginCode(email, code));
  }

  function changeEmail() {
    step = 'email';
    code = '';
    error = '';
    info = '';
  }

  function onCodeInput(event: Event & { currentTarget: HTMLInputElement }) {
    // Nur Ziffern; Leerzeichen o.ä. aus eingefügten Codes fallen weg
    code = event.currentTarget.value.replace(/\D/g, '').slice(0, LOGIN_CODE_LENGTH);
    event.currentTarget.value = code;
  }
</script>

<main class="narrow">
  <h1>Pen &amp; Paper Manager</h1>
  <p class="muted">Kampagnenverwaltung für FATE-Runden</p>
  {#if step === 'email'}
    <form class="card" onsubmit={sendCode} novalidate aria-labelledby="login-heading">
      <h2 id="login-heading">Einloggen</h2>
      <label>
        E-Mail-Adresse
        <input
          type="email"
          bind:value={email}
          required
          maxlength={MAX_EMAIL_LENGTH}
          autocomplete="email"
          placeholder="du@example.org"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'login-error' : 'login-hint'}
        />
      </label>
      {#if error}<p class="error" id="login-error" role="alert">{error}</p>{/if}
      <button class="primary" disabled={busy} aria-busy={busy}>{busy ? 'Code wird gesendet …' : 'Code senden'}</button>
      <p class="muted" id="login-hint">Wir schicken dir einen Code per E-Mail, mit dem du dich einloggst.</p>
    </form>
  {:else}
    <form class="card" onsubmit={verify} novalidate aria-labelledby="login-heading">
      <h2 id="login-heading">Code eingeben</h2>
      <p id="code-hint">Wir haben einen {LOGIN_CODE_LENGTH}-stelligen Code an <strong>{email}</strong> geschickt.</p>
      <label>
        Code aus der E-Mail
        <!-- Nach dem Wechsel in diesen Schritt wird genau diese Eingabe erwartet -->
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="code"
          type="text"
          value={code}
          oninput={onCodeInput}
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern={`[0-9]{${LOGIN_CODE_LENGTH}}`}
          maxlength={LOGIN_CODE_LENGTH}
          required
          autofocus
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'code-hint login-error' : 'code-hint'}
        />
      </label>
      {#if error}<p class="error" id="login-error" role="alert">{error}</p>{/if}
      {#if info}<p class="muted" role="status">{info}</p>{/if}
      <p><button class="primary" disabled={busy} aria-busy={busy}>{busy ? 'Code wird geprüft …' : 'Einloggen'}</button></p>
      <div class="row">
        <button type="button" onclick={resend} disabled={busy || cooldown > 0}>
          Code erneut senden{cooldown > 0 ? ` (${cooldown} s)` : ''}
        </button>
        <button type="button" onclick={changeEmail} disabled={busy}>Andere E-Mail verwenden</button>
      </div>
    </form>
  {/if}
</main>

<style>
  .narrow { max-width: 26rem; margin-top: 10vh; }
  h2 { margin-top: 0; font-size: 1.2rem; }
  .code { font-size: 1.5rem; letter-spacing: 0.4em; font-variant-numeric: tabular-nums; }
</style>
