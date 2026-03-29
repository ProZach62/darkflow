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

    // Preserve active tab
    const activeTab = bodyEl.querySelector('.inv-tab.active');
    const currentTab = activeTab ? activeTab.dataset.tab : 'all';

    // Parse slot from item name parenthetical
    const slotPattern = /\(([^)]+)\)\s*$/;
    const slotMap = {
      'worn on head': 'Head', 'worn around the neck': 'Neck',
      'worn over the shoulders': 'Shoulders', 'worn on body': 'Body',
      'worn on body and legs': 'Body+Legs', 'worn as a full suit of armour': 'FullSuit',
      'worn on hands': 'Hands', 'worn on legs': 'Legs', 'worn on feet': 'Feet',
      'worn on finger': 'Finger', 'used as shield': 'Shield',
      'main weapon': 'Main Weapon', 'secondary weapon': 'Off-hand',
      'used as light': 'Light',
    };

    function cleanName(name) {
      let n = name.replace(/^\*/, '').replace(slotPattern, '').trim();
      return n.charAt(0).toUpperCase() + n.slice(1);
    }

    function getSlot(name) {
      const m = name.match(slotPattern);
      return m ? (slotMap[m[1]] || null) : null;
    }

    // Categorize items
    const wielded = [], worn = [], containers = [], carried = [];
    const slots = {};

    for (const item of data) {
      const clean = cleanName(item.name);
      const slot = getSlot(item.name);
      const entry = { id: item.id, name: clean, attrib: item.attrib, slot: slot, raw: item.name };

      if (item.attrib === 'l') { wielded.push(entry); if (slot) slots[slot] = entry; }
      else if (item.attrib === 'w') { worn.push(entry); if (slot) slots[slot] = entry; }
      else if (item.attrib === 'c') containers.push(entry);
      else carried.push(entry);

      // Handle multi-slot items
      if (slot === 'Body+Legs') { slots['Body'] = entry; slots['Legs'] = entry; }
      if (slot === 'FullSuit') { ['Body','Legs','Head','Hands','Feet'].forEach(s => slots[s] = entry); }
    }

    wielded.sort((a, b) => a.name.localeCompare(b.name));
    worn.sort((a, b) => a.name.localeCompare(b.name));
    containers.sort((a, b) => a.name.localeCompare(b.name));
    carried.sort((a, b) => a.name.localeCompare(b.name));

    // Build tabs
    let html = '<div class="inv-tabs">';
    const tabs = [['all','All'],['worn','Worn'],['wielded','Wielded'],['carried','Carried']];
    for (const [id, label] of tabs) {
      html += '<button class="inv-tab' + (currentTab === id ? ' active' : '') + '" data-tab="' + id + '">' + label + '</button>';
    }
    html += '</div>';

    // All tab
    html += '<div class="inv-tab-content' + (currentTab === 'all' ? ' active' : '') + '" data-tab="all"><div class="inv-list">';
    if (wielded.length) {
      html += '<div class="inv-group-header">WIELDED</div>';
      for (const e of wielded) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    if (worn.length) {
      html += '<div class="inv-group-header">WORN</div>';
      for (const e of worn) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    if (containers.length) {
      html += '<div class="inv-group-header">CONTAINERS</div>';
      for (const e of containers) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    if (carried.length) {
      html += '<div class="inv-group-header">CARRIED</div>';
      for (const e of carried) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    html += '</div></div>';

    // Worn tab - paper doll
    html += '<div class="inv-tab-content' + (currentTab === 'worn' ? ' active' : '') + '" data-tab="worn">';
    html += '<div class="inv-paperdoll">';
    const dollSlots = [
      ['Head',null,'Head'],
      ['Neck',null,'Neck'],
      ['Shoulders',null,'Shoulders'],
      ['Body',null,'Body'],
      ['Hands','Shield','Hands / Shield'],
      ['Legs',null,'Legs'],
      ['Feet',null,'Feet'],
      ['Finger',null,'Finger'],
    ];
    for (const [left, right] of dollSlots) {
      if (right) {
        // Two-column row
        html += '<div class="inv-doll-row inv-doll-row-split">';
        html += renderSlot(left, slots[left]);
        html += renderSlot(right, slots[right]);
        html += '</div>';
      } else {
        html += '<div class="inv-doll-row">';
        html += renderSlot(left, slots[left]);
        html += '</div>';
      }
    }
    html += '</div></div>';

    // Wielded tab
    html += '<div class="inv-tab-content' + (currentTab === 'wielded' ? ' active' : '') + '" data-tab="wielded">';
    html += '<div class="inv-wield-list">';
    const wieldSlots = ['Main Weapon', 'Off-hand', 'Shield', 'Light'];
    for (const ws of wieldSlots) {
      const item = slots[ws];
      html += '<div class="inv-wield-slot">';
      html += '<span class="inv-wield-label">' + ws + '</span>';
      html += '<span class="' + (item ? 'inv-wield-item' : 'inv-wield-empty') + '">' + (item ? escHtml(item.name) : 'empty') + '</span>';
      html += '</div>';
    }
    html += '</div></div>';

    // Carried tab
    html += '<div class="inv-tab-content' + (currentTab === 'carried' ? ' active' : '') + '" data-tab="carried"><div class="inv-list">';
    if (containers.length) {
      html += '<div class="inv-group-header">CONTAINERS</div>';
      for (const e of containers) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    const carriedAll = carried;
    if (carriedAll.length) {
      if (containers.length) html += '<div class="inv-group-header">ITEMS</div>';
      for (const e of carriedAll) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    if (!containers.length && !carriedAll.length) {
      html += '<div class="placeholder">Nothing carried</div>';
    }
    html += '</div></div>';

    bodyEl.innerHTML = html;

    // Tab click handlers
    bodyEl.querySelectorAll('.inv-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        bodyEl.querySelectorAll('.inv-tab').forEach(t => t.classList.remove('active'));
        bodyEl.querySelectorAll('.inv-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const content = bodyEl.querySelector('.inv-tab-content[data-tab="' + tab.dataset.tab + '"]');
        if (content) content.classList.add('active');
      });
    });

    function renderSlot(label, item) {
      if (item) {
        return '<div class="inv-doll-slot inv-doll-filled"><div class="inv-doll-slot-label">' + label + '</div><div class="inv-doll-slot-item">' + escHtml(item.name) + '</div></div>';
      }
      return '<div class="inv-doll-slot inv-doll-empty"><div class="inv-doll-slot-label">' + label + '</div><div class="inv-doll-slot-item">empty</div></div>';
    }
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
      const talker = msg.talker ? msg.talker.charAt(0).toUpperCase() + msg.talker.slice(1) : '';
      // Strip "[Channel] Talker: " prefix from text if present
      let text = msg.text || '';
      const prefixPattern = new RegExp('^\\[\\S+\\]\\s+\\S+:\\s*');
      text = text.replace(prefixPattern, '');
      entry.innerHTML = '<span class="chat-channel" style="color:' + ch + '">[' + escHtml(msg.channel) + ']</span> '
        + '<span class="chat-talker">' + escHtml(talker) + ':</span> '
        + escHtml(text);
      log.appendChild(entry);
    }

    while (log.childNodes.length > 200) log.removeChild(log.firstChild);

    if (wasAtBottom) log.scrollTop = log.scrollHeight;
  },
};
