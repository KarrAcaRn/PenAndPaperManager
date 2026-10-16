import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { applyStoredTheme } from './lib/userSettings.svelte.ts';

applyStoredTheme();

export default mount(App, { target: document.getElementById('app')! });
