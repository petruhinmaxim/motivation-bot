const WEEKDAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const defaults = () => ({
  screen: 'welcome',
  returnScreen: 'welcome',
  stubTab: null,
  dialog: false,
  started: false,
  startMode: null,
  duration: 15,
  days: new Set(),
  time: '15:00',
  timezone: 0,
  successfulDays: 0,
  saving: false,
  launchError: null,
  launched: null,
});

function detectMskOffset() {
  const offsetMinutes = -new Date().getTimezoneOffset();
  if (offsetMinutes % 60 !== 0) {
    return null;
  }

  const mskOffset = offsetMinutes / 60 - 3;
  if (mskOffset < -3 || mskOffset > 9) {
    return null;
  }

  return mskOffset;
}

const detectedTimezone = detectMskOffset();
const state = defaults();

if (detectedTimezone !== null) {
  state.timezone = detectedTimezone;
}

if (new URLSearchParams(window.location.search).get('screen') === 'settings') {
  state.screen = 'settings';
}

const screens = document.querySelectorAll('[data-screen]');
const dialog = document.getElementById('exit-dialog');
const durationInput = document.getElementById('duration');
const timeInput = document.getElementById('reminder-time');
const timezoneInput = document.getElementById('timezone');

if (detectedTimezone !== null) {
  timezoneInput.hidden = true;
  timezoneInput.closest('.time-row').classList.add('time-row-full');
}
const hint = document.getElementById('settings-hint');
const scheduleButton = document.getElementById('start-schedule');
const nowButton = document.getElementById('start-now');
const dayButtons = document.querySelectorAll('[data-day]');
const tabButtons = document.querySelectorAll('[data-tab]');

function formatOffset(offset) {
  return `${offset >= 0 ? '+' : ''}${offset} МСК`;
}

function formatDay(date) {
  return `${WEEKDAY_SHORT[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function nextActivityDate(days) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = new Date(today);
    candidate.setDate(today.getDate() + offset);
    if (days.length === 0 || days.includes(candidate.getDay())) {
      return candidate;
    }
  }

  return today;
}

function canLaunch() {
  return state.days.size > 0 && Boolean(state.time);
}

function telegramInitData() {
  return window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData;
}

function applyChallenge(data) {
  state.started = true;
  state.startMode = data.startMode;
  state.successfulDays = data.successfulDays;
  state.duration = data.duration;
  state.time = data.reminderTime;
  state.timezone = data.timezoneMsk;
  state.days = new Set(data.activityDays);
  state.launched = {
    duration: data.duration,
    days: data.activityDays,
    time: data.reminderTime,
    timezone: data.timezoneMsk,
  };
  state.screen = 'home';
  state.launchError = null;
}

function resetSettings() {
  state.duration = 15;
  state.days = new Set();
  state.time = '15:00';
  state.timezone = detectedTimezone ?? 0;
  state.successfulDays = 0;
  state.launchError = null;
}

function showScreen(name) {
  screens.forEach((screen) => {
    screen.hidden = screen.dataset.screen !== name;
  });
}

function renderSettings() {
  durationInput.value = String(state.duration);
  timeInput.value = state.time;
  timezoneInput.value = String(state.timezone);
  dayButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(state.days.has(Number(button.dataset.day))));
  });
  const ready = canLaunch() && !state.saving;
  scheduleButton.disabled = !ready;
  nowButton.disabled = !ready;
  hint.hidden = ready && !state.launchError;
  hint.textContent = state.launchError || '* не все настроено';
}

function renderHome() {
  const launched = state.launched;
  if (!launched) {
    return;
  }

  const startedNow = state.startMode === 'now';
  document.getElementById('progress').textContent = `${state.successfulDays} из ${launched.duration}`;
  document.getElementById('reminder').textContent = `${launched.time} (${formatOffset(launched.timezone)})`;
  document.getElementById('home-banner').textContent = startedNow
    ? 'Ура ура! Ты лучший. Начинаем сегодня'
    : 'Что мы говорим Богу спорта? Не сегодня! Увидимся позже';
  document.getElementById('today-icon').textContent = startedNow ? '🏆' : '📦';
  document.getElementById('next-day').textContent = formatDay(nextActivityDate(launched.days));

  const checkin = document.getElementById('checkin');
  checkin.textContent = startedNow ? 'Я Сделал!' : 'Не получилось отправить';
  checkin.className = startedNow ? 'button now' : 'button idle';
}

function renderTabs() {
  tabButtons.forEach((button) => {
    const tab = button.dataset.tab;
    const active = ((state.screen === 'home' || state.screen === 'welcome') && tab === 'home')
      || (state.screen === 'stub' && tab === state.stubTab);
    if (active) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  });
}

function render() {
  showScreen(state.screen);
  dialog.hidden = !state.dialog;
  renderSettings();
  renderHome();
  renderTabs();
}

function openStub(tab) {
  if (state.screen !== 'stub') {
    state.returnScreen = state.screen;
  }
  state.stubTab = tab;
  state.screen = 'stub';
  state.dialog = false;
  render();
}

function openHome() {
  if (!state.started) {
    state.screen = 'welcome';
    state.stubTab = null;
    state.dialog = false;
    render();
    return;
  }
  state.screen = 'home';
  state.stubTab = null;
  state.dialog = false;
  render();
}

async function launch(mode) {
  if (!canLaunch() || state.saving) {
    return;
  }

  const initData = telegramInitData();
  if (!initData) {
    state.launchError = 'Открой приложение из Telegram';
    render();
    return;
  }

  state.saving = true;
  state.launchError = null;
  state.dialog = false;
  render();

  try {
    const response = await fetch('/api/challenge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': initData,
      },
      body: JSON.stringify({
        mode,
        duration: state.duration,
        days: [...state.days],
        time: state.time,
        timezone: state.timezone,
      }),
    });

    if (!response.ok) {
      throw new Error(`Challenge request failed: ${response.status}`);
    }

    applyChallenge(await response.json());
  } catch (error) {
    state.launchError = 'Не удалось запустить челлендж';
  } finally {
    state.saving = false;
    render();
  }
}

document.getElementById('begin').addEventListener('click', () => {
  state.screen = 'settings';
  state.dialog = false;
  render();
});

document.getElementById('settings-back').addEventListener('click', () => {
  state.dialog = true;
  render();
});

document.getElementById('exit-no').addEventListener('click', () => {
  state.dialog = false;
  render();
});

document.getElementById('exit-yes').addEventListener('click', () => {
  resetSettings();
  state.screen = 'welcome';
  state.dialog = false;
  render();
});

durationInput.addEventListener('change', () => {
  state.duration = Number(durationInput.value);
  render();
});

timeInput.addEventListener('change', () => {
  state.time = timeInput.value;
  render();
});

timezoneInput.addEventListener('change', () => {
  state.timezone = Number(timezoneInput.value);
});

dayButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const day = Number(button.dataset.day);
    if (state.days.has(day)) {
      state.days.delete(day);
    } else {
      state.days.add(day);
    }
    render();
  });
});

document.getElementById('start-now').addEventListener('click', () => launch('now'));
document.getElementById('start-schedule').addEventListener('click', () => launch('schedule'));

document.getElementById('stub-back').addEventListener('click', () => {
  state.screen = state.returnScreen;
  state.stubTab = null;
  render();
});

document.querySelectorAll('[data-stub]').forEach((button) => {
  button.addEventListener('click', () => openStub(button.dataset.stub));
});

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const tab = button.dataset.tab;
    if (tab === 'home') {
      openHome();
      return;
    }
    openStub(tab);
  });
});

const telegramApp = window.Telegram && window.Telegram.WebApp;
if (telegramApp) {
  telegramApp.ready();
  telegramApp.expand();
}

async function boot() {
  const initData = telegramInitData();
  if (initData) {
    try {
      const response = await fetch('/api/challenge', {
        headers: { 'X-Telegram-Init-Data': initData },
      });
      if (response.ok) {
        applyChallenge(await response.json());
      }
    } catch (error) {
      state.launchError = null;
    }
  }

  render();
}

boot();
