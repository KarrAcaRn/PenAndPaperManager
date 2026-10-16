import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

// Das zuletzt verwendete Theme und Farbschema setzt schon das Inline-Skript in index.html (vor dem ersten Zeichnen).

export default mount(App, { target: document.getElementById('app')! });
