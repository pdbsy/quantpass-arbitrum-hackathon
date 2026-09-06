const search = document.querySelector('#task-search');
const phase = document.querySelector('#phase-filter');
const status = document.querySelector('#status-filter');
const risk = document.querySelector('#risk-filter');
const reset = document.querySelector('#reset-filter');
const output = document.querySelector('#filter-status');
const cards = [...document.querySelectorAll('[data-task]')];
const sections = [...document.querySelectorAll('[data-phase-section]')];

function update() {
  const query = search.value.trim().toLocaleLowerCase('zh-CN');
  let visible = 0;
  for (const card of cards) {
    const matches =
      (!query || card.textContent.toLocaleLowerCase('zh-CN').includes(query)) &&
      (phase.value === 'all' || card.dataset.phase === phase.value) &&
      (status.value === 'all' || card.dataset.status === status.value) &&
      (risk.value === 'all' || card.dataset.risk === risk.value);
    card.hidden = !matches;
    if (matches) visible++;
  }
  for (const section of sections) {
    section.hidden = !section.querySelector('[data-task]:not([hidden])');
  }
  output.textContent = `显示 ${visible} / ${cards.length} 个任务`;
}

for (const control of [search, phase, status, risk]) {
  control.addEventListener(control === search ? 'input' : 'change', update);
}

reset.addEventListener('click', () => {
  search.value = '';
  phase.value = 'all';
  status.value = 'all';
  risk.value = 'all';
  update();
  search.focus();
});

update();
