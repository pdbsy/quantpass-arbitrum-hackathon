(function () {
  'use strict';
  const snapshot = JSON.parse(document.getElementById('forum-snapshot').textContent);
  const agents = ['Macbeth01', 'Macbeth02', 'Macbeth03', 'Macbeth04', 'Macbeth05'];
  const types = ['CHECK_IN', 'NOTICE', 'QUESTION', 'REPLY', 'ACK', 'BLOCKED', 'SUMMARY'];
  const $ = (id) => document.getElementById(id);
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function option(value, text) {
    const node = el('option', '', text);
    node.value = value;
    return node;
  }
  function safeLink(url, text) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return el('span', '', '来源链接无效');
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'github.com' ||
      !/^\/pdbsy\/quantpass-arbitrum-hackathon\/pull\/\d+$/.test(parsed.pathname)
    )
      return el('span', '', '来源链接无效');
    const link = el('a', 'source-link', text);
    link.href = parsed.toString();
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }
  function date(value) {
    return value ? new Date(value).toLocaleString('zh-CN') : '未知';
  }
  for (const agent of agents) $('agent-filter').append(option(agent, agent));
  for (const type of types) $('type-filter').append(option(type, type));
  for (const thread of snapshot.threads) $('thread-filter').append(option(thread.thread, thread.thread));
  const source = $('source');
  const stale =
    !snapshot.source.last_sync_at || Date.now() - Date.parse(snapshot.source.last_sync_at) > 15 * 60 * 1000;
  source.className = `source${snapshot.source.state === 'ERROR' ? ' error' : stale ? ' stale' : ''}`;
  source.append(el('strong', '', `SOURCE ${snapshot.source.state}${stale ? ' · STALE' : ''}`));
  source.append(
    document.createTextNode(
      `Last sync: ${date(snapshot.source.last_sync_at)}${snapshot.source.error ? ` · ${snapshot.source.error}` : ''}`,
    ),
  );
  function filtered() {
    const keyword = $('keyword').value.trim().toLocaleLowerCase();
    return snapshot.messages.filter(
      (item) =>
        (!$('agent-filter').value || item.agent === $('agent-filter').value) &&
        (!$('type-filter').value || item.type === $('type-filter').value) &&
        (!$('thread-filter').value || item.thread === $('thread-filter').value) &&
        (!keyword ||
          [item.agent, item.github_author, item.type, item.thread, item.body]
            .join(' ')
            .toLocaleLowerCase()
            .includes(keyword)),
    );
  }
  function render() {
    const messages = filtered();
    $('message-count').textContent = String(messages.length);
    $('thread-count').textContent = String(new Set(messages.map((item) => item.thread)).size);
    $('unack-count').textContent = String(
      messages.filter((item) => item.ack_state === 'UNACKNOWLEDGED').length,
    );
    const forum = $('forum');
    forum.replaceChildren();
    if (!messages.length) {
      forum.append(el('div', 'empty', '当前筛选条件下没有已同步的 Agent 消息。'));
      return;
    }
    const groups = new Map();
    for (const item of messages) {
      const group = groups.get(item.thread) || [];
      group.push(item);
      groups.set(item.thread, group);
    }
    for (const [threadName, items] of groups) {
      const section = el('section', 'thread');
      section.append(el('h2', '', `THREAD · ${threadName}`));
      const list = el('div', 'messages');
      for (const item of items) {
        const card = el('article', 'message');
        const top = el('div', 'row');
        const title = el('div');
        title.append(el('span', 'agent', item.agent), el('span', 'type', item.type));
        top.append(
          title,
          el('span', `ack${item.ack_state === 'ACKNOWLEDGED' ? ' yes' : ''}`, item.ack_state),
        );
        const body = el('div', 'body', item.body);
        const meta = el('div', 'meta');
        meta.append(
          el('span', '', `GitHub: ${item.github_author}`),
          el('span', '', `To: ${item.to}`),
          el('span', '', `PR: #${item.pr_number}`),
          el('span', '', `Created: ${date(item.created_at)}`),
          el('span', '', `Updated: ${date(item.updated_at)}`),
          el('span', '', `Source: ${item.source_type}`),
          safeLink(item.related_pr, 'Related PR ↗'),
          safeLink(item.source_url, 'Original source ↗'),
        );
        if (item.reply_to) meta.append(safeLink(item.reply_to, 'Reply-To ↗'));
        card.append(top, body, meta);
        list.append(card);
      }
      section.append(list);
      forum.append(section);
    }
  }
  for (const id of ['keyword', 'agent-filter', 'type-filter', 'thread-filter'])
    $(id).addEventListener(id === 'keyword' ? 'input' : 'change', render);
  render();
})();
