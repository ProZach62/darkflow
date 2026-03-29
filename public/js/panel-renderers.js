import { state } from './state.js';
import { appendEcho } from './output.js';

export function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export function channelColor(channel) {
  let hash = 0;
  for (let i = 0; i < channel.length; i++) hash = ((hash << 5) - hash + channel.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return 'hsl(' + hue + ', 60%, 65%)';
}

export function vitalBarColor(pct) {
  if (pct > 60) return '#3fb950';
  if (pct > 30) return '#d29922';
  return '#f85149';
}

export function renderVitalBar(bodyEl, label, cur, max) {
  let row = bodyEl.querySelector('.vitals-' + label.toLowerCase());
  const pct = max > 0 ? Math.round((cur / max) * 100) : 0;
  if (!row) {
    row = document.createElement('div');
    row.className = 'vitals-row vitals-' + label.toLowerCase();
    row.innerHTML =
      '<div class="vitals-label"><span>' + label + '</span><span class="vitals-val"></span></div>' +
      '<div class="vitals-bar"><div class="vitals-bar-fill"></div></div>';
    bodyEl.appendChild(row);
  }
  row.querySelector('.vitals-val').textContent = cur + ' / ' + max;
  const fill = row.querySelector('.vitals-bar-fill');
  fill.style.width = pct + '%';
  fill.style.backgroundColor = vitalBarColor(pct);
}

export const panelRenderers = {
  vitals(bodyEl, data) {
    if (!data) return;
    if (bodyEl.querySelector('.placeholder')) bodyEl.innerHTML = '';
    renderVitalBar(bodyEl, 'HP', data.hp, data.maxhp);
    renderVitalBar(bodyEl, 'SP', data.sp, data.maxsp);
  },

  stats(bodyEl, data) {
    if (!data || !data.current) return;
    const cur = data.current;
    const base = data.base || {};
    const statNames = [
      ['STR', 'str', 'realstr'],
      ['INT', 'int', 'realint'],
      ['WIS', 'wis', 'realwis'],
      ['DEX', 'dex', 'realdex'],
      ['CON', 'con', 'realcon'],
      ['CHR', 'chr', 'realchr'],
    ];
    let html = '<table class="stats-table">';
    for (const [label, key, baseKey] of statNames) {
      const c = cur[key] || 0;
      const b = base[baseKey] !== undefined ? base[baseKey] : c;
      let cls = '';
      if (c > b) cls = ' class="stat-up"';
      else if (c < b) cls = ' class="stat-down"';
      html += '<tr><td>' + label + '</td><td' + cls + '>' + c + '</td><td style="color:#484f58">' + b + '</td></tr>';
    }
    html += '</table>';
    bodyEl.innerHTML = html;
  },

  status(bodyEl, data) {
    if (!data) return;
    const fields = [
      ['Name', data.fullname || data.name],
      ['Race', data.race],
      ['Class', data.class],
      ['Level', data.level],
      ['XP', data.xp],
      ['Align', data.align],
      ['Title', data.title],
      ['Gender', data.gender],
    ];
    let html = '';
    for (const [k, v] of fields) {
      if (v !== undefined && v !== null && v !== '' && v !== 'None') {
        html += '<div class="status-row"><span class="status-key">' + k + '</span><span>' + v + '</span></div>';
      }
    }
    const badges = [];
    if (data.dead === 'Yes') badges.push('<span class="status-badge badge-dead">Dead</span>');
    if (data.drunk && data.drunk !== 'Sober' && data.drunk !== 'None') badges.push('<span class="status-badge badge-drunk">Drunk</span>');
    if (data.hunger && data.hunger !== 'Satiated' && data.hunger !== 'Not hungry' && data.hunger !== 'None') badges.push('<span class="status-badge badge-hungry">Hungry</span>');
    if (data.invis === 'Yes') badges.push('<span class="status-badge badge-invis">Invis</span>');
    if (data.sit === 'Yes') badges.push('<span class="status-badge badge-sitting">Sitting</span>');
    if (data.viking === 'Yes') badges.push('<span class="status-badge badge-viking">Viking</span>');
    if (badges.length) html += '<div class="status-badges">' + badges.join('') + '</div>';
    bodyEl.innerHTML = html;
  },

  worth(bodyEl, data) {
    if (!data) return;
    const gold = (data.gold || 0).toLocaleString();
    const bank = (data.bank || 0).toLocaleString();
    bodyEl.innerHTML =
      '<div class="status-row"><span class="status-key">Gold</span><span>' + gold + '</span></div>' +
      '<div class="status-row"><span class="status-key">Bank</span><span>' + bank + '</span></div>';
  },

  room(bodyEl, data) {
    if (!data || !data.name) return;
    let html = '<div class="room-name">' + escHtml(data.name) + '</div>';
    if (data.area) html += '<div class="room-area">' + escHtml(data.area) + '</div>';
    if (data.environment) html += '<div class="room-env">' + escHtml(data.environment) + '</div>';

    const exits = (data.exits && typeof data.exits === 'object') ? data.exits : {};
    const compassDirs = ['northwest','north','northeast','west',null,'east','southwest','south','southeast'];
    const dirLabels = { northwest:'NW', north:'N', northeast:'NE', west:'W', east:'E', southwest:'SW', south:'S', southeast:'SE', up:'U', down:'D' };

    html += '<div class="exit-compass">';
    for (const dir of compassDirs) {
      if (dir === null) {
        html += '<div></div>';
      } else if (exits[dir] !== undefined) {
        html += '<button class="exit-btn" data-dir="' + dir + '">' + dirLabels[dir] + '</button>';
      } else {
        html += '<div class="exit-btn inactive"></div>';
      }
    }
    html += '</div>';

    if (exits.up !== undefined || exits.down !== undefined) {
      html += '<div class="exit-ud">';
      html += exits.up !== undefined
        ? '<button class="exit-btn" data-dir="up">U</button>'
        : '<div class="exit-btn inactive"></div>';
      html += exits.down !== undefined
        ? '<button class="exit-btn" data-dir="down">D</button>'
        : '<div class="exit-btn inactive"></div>';
      html += '</div>';
    }

    if (Array.isArray(data.players) && data.players.length) {
      html += '<div class="room-players">Players: ';
      html += data.players.map(p => '<span>' + escHtml(p.fullname || p.name) + '</span>').join(', ');
      html += '</div>';
    }

    bodyEl.innerHTML = html;

    bodyEl.querySelectorAll('.exit-btn[data-dir]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
          const dir = btn.dataset.dir;
          state.ws.send(dir);
          appendEcho(dir);
        }
      });
    });
  },

  inventory(bodyEl, data) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      bodyEl.innerHTML = '<div class="placeholder">Empty</div>';
      return;
    }
    const badgeMap = {
      'w': '<span class="inv-badge inv-badge-w">wld</span>',
      'W': '<span class="inv-badge inv-badge-W">wrn</span>',
      'l': '<span class="inv-badge inv-badge-l">lit</span>',
      'c': '<span class="inv-badge inv-badge-c">cnt</span>',
      'm': '<span class="inv-badge inv-badge-m">npc</span>',
    };
    let html = '<div class="inv-list">';
    for (const item of data) {
      const badge = badgeMap[item.attrib] || '';
      html += '<div class="inv-item">' + badge + '<span>' + escHtml(item.name) + '</span></div>';
    }
    html += '</div>';
    bodyEl.innerHTML = html;
  },

  enemy(bodyEl, data) {
    if (!data || !data.enemy_name || data.enemy_name === 'None' || data.enemy_name === '') {
      bodyEl.innerHTML = '<div class="panel-inactive placeholder">No target</div>';
      return;
    }
    bodyEl.innerHTML = '';
    const nameDiv = document.createElement('div');
    nameDiv.className = 'enemy-name';
    nameDiv.textContent = data.enemy_name;
    bodyEl.appendChild(nameDiv);

    if (data.enemy_hp_string && data.enemy_hp_string !== 'None') {
      const hpStr = document.createElement('div');
      hpStr.style.cssText = 'font-size:11px;color:#8b949e;margin-bottom:4px';
      hpStr.textContent = data.enemy_hp_string;
      bodyEl.appendChild(hpStr);
    }

    renderVitalBar(bodyEl, 'HP', data.enemy_curhp, data.enemy_maxhp || 100);
    if (data.enemy_maxsp > 0) {
      renderVitalBar(bodyEl, 'SP', data.enemy_cursp, data.enemy_maxsp);
    }
  },

  group(bodyEl, data) {
    if (!data || data === '' || (typeof data === 'object' && (!data.members || data.members.length === 0))) {
      bodyEl.innerHTML = '<div class="placeholder">Not in a group</div>';
      return;
    }
    let html = '<div class="group-header">';
    html += '<strong>' + escHtml(data.groupname || 'Group') + '</strong>';
    if (data.leader) html += ' &middot; Leader: ' + escHtml(data.leader);
    if (data.count) html += ' &middot; ' + data.count + ' members';
    html += '</div>';

    if (Array.isArray(data.members)) {
      for (const m of data.members) {
        const info = m.info || {};
        const here = info.here === 'Yes';
        html += '<div class="group-member' + (here ? '' : ' group-member-away') + '">';
        html += '<span class="group-member-name">' + escHtml(m.name) + '</span>';
        html += ' <span style="color:#484f58">Lv' + (info.lvl || '?') + '</span>';
        const hpPct = info.maxhp > 0 ? Math.round((info.hp / info.maxhp) * 100) : 0;
        html += '<div class="group-mini-bar"><div class="group-mini-bar-fill" style="width:' + hpPct + '%;background:' + vitalBarColor(hpPct) + '"></div></div>';
        html += '</div>';
      }
    }
    bodyEl.innerHTML = html;
  },

  chat(bodyEl, data) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      bodyEl.innerHTML = '<div class="placeholder">No messages</div>';
      return;
    }
    let log = bodyEl.querySelector('.chat-log');
    const wasAtBottom = log ? (log.scrollHeight - log.scrollTop - log.clientHeight) < 5 : true;

    if (!log) {
      log = document.createElement('div');
      log.className = 'chat-log';
      bodyEl.innerHTML = '';
      bodyEl.appendChild(log);
    }

    const existing = log.childNodes.length;
    const toRender = data.slice(existing);

    for (const msg of toRender) {
      const entry = document.createElement('div');
      entry.className = 'chat-entry';
      const ch = channelColor(msg.channel || '');
      entry.innerHTML = '<span class="chat-channel" style="color:' + ch + '">[' + escHtml(msg.channel) + ']</span> '
        + '<span class="chat-talker">' + escHtml(msg.talker) + ':</span> '
        + escHtml(msg.text);
      log.appendChild(entry);
    }

    while (log.childNodes.length > 200) log.removeChild(log.firstChild);

    if (wasAtBottom) log.scrollTop = log.scrollHeight;
  },
};
