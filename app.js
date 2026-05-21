/* ===== UYAP Web Doküman Editörü — app.js ===== */

(function () {
  'use strict';

  // ===== Toast — IIFE başında tanımla, her yerden çalışsın =====
  window.showToast = window.showToastPublic = function(message, type) {
    const container = document.getElementById('toastContainer');
    if (!container) { if (type === 'error' || type === 'warning') alert(message); return; }
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'info');
    const iconMap = { success: 'check_circle', error: 'error', info: 'info', warning: 'warning' };
    toast.innerHTML = `<span class="material-icons-outlined">${iconMap[type] || 'info'}</span><span>${message}</span>`;
    container.appendChild(toast);
    const dur = type === 'error' ? 5000 : 3000;
    setTimeout(() => { toast.style.cssText += 'opacity:0;transform:translateX(20px);transition:0.3s'; setTimeout(() => toast.remove(), 300); }, dur);
  };
  const showToast = window.showToast;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const editorWrapper = $('#editorWrapper');
  const documentTitle = $('#documentTitle');
  const saveStatus = $('#saveStatus');

  // İmza state — sadece memory'de tutulur, localStorage'a yazılmaz
  let lastSignature = null;   // base64 signedMime
  let lastSignerName = null;  // sertifika sahibinin adı
  let lastCertDetails = null; // detaylı sertifika bilgisi

  // Toolbar buttons
  const btnUndo = $('#btnUndo');
  const btnRedo = $('#btnRedo');
  const selectHeading = $('#selectHeading');
  const selectFont = $('#selectFont');
  const selectSize = $('#selectSize');
  const btnBold = $('#btnBold');
  const btnItalic = $('#btnItalic');
  const btnUnderline = $('#btnUnderline');
  const btnStrike = $('#btnStrike');
  const btnTextColor = $('#btnTextColor');
  const btnHighlight = $('#btnHighlight');
  const inputTextColor = $('#inputTextColor');
  const inputHighlightColor = $('#inputHighlightColor');
  const textColorIndicator = $('#textColorIndicator');
  const highlightIndicator = $('#highlightIndicator');
  const btnAlignLeft = $('#btnAlignLeft');
  const btnAlignCenter = $('#btnAlignCenter');
  const btnAlignRight = $('#btnAlignRight');
  const btnAlignJustify = $('#btnAlignJustify');
  const btnBulletList = $('#btnBulletList');
  const btnNumberList = $('#btnNumberList');
  const btnIndent = $('#btnIndent');
  const btnOutdent = $('#btnOutdent');

  // Status bar
  const wordCountEl = $('#wordCount');
  const charCountEl = $('#charCount');
  const lineCountEl = $('#lineCount');
  const zoomLevelEl = $('#zoomLevel');

  // Find & Replace
  const findReplacePanel = $('#findReplacePanel');
  const findInput = $('#findInput');
  const replaceInput = $('#replaceInput');
  const findCountEl = $('#findCount');

  // File inputs
  const fileInput = $('#fileInput');
  const imageInput = $('#imageInput');

  // State
  let currentZoom = 100;
  let isDark = false;
  let autoSaveTimer = null;

  // ===== Pagination Manager =====
  const PaginationManager = {
    PAGE_HEIGHT: 1122, // A4 height in px approx (29.7cm)
    MAX_EDITOR_HEIGHT: 922, // Exactly 1122px (A4) - 100px (Header) - 100px (Footer)

    init() {
      // Clear existing and start with one page
      const wrapper = $('#editorWrapper');
      wrapper.innerHTML = ''; // Start clean
      this.addPage();
    },

    getActivePage() {
      const sel = window.getSelection();
      if (!sel || !sel.anchorNode) {
        // Fallback to first page with an editor
        return $('.page-container:has(.editor)') || $('.page-container');
      }
      let node = sel.anchorNode;
      while (node && node !== document.body) {
        if (node.classList && node.classList.contains('page-container')) return node;
        node = node.parentNode;
      }
      return $('.page-container:has(.editor)') || $('.page-container');
    },

    addPage(afterPage = null) {
      const page = document.createElement('div');
      page.className = 'page-container';
      page.innerHTML = `
        <div class="header-area" contenteditable="true" data-placeholder="Üst Bilgi" data-visible="false"></div>
        <div class="editor" contenteditable="true" spellcheck="false" data-placeholder="Yazmaya başlayın..."></div>
        <div class="footer-area" contenteditable="true" data-placeholder="Alt Bilgi" data-visible="false"></div>
        <div class="page-number page-number-display"></div>
      `;

      // Header ve footer varsayılan olarak görünmez (ama alan korunur)
      const hdr = page.querySelector('.header-area');
      const ftr = page.querySelector('.footer-area');
      hdr.style.visibility = 'hidden';
      ftr.style.visibility = 'hidden';

      if (afterPage) {
        afterPage.after(page);
      } else {
        $('#editorWrapper').appendChild(page);
      }

      this.initPageEvents(page);
      this.syncHeadersFooters();
      this.updatePageNumbers();
      return page;
    },

    initPageEvents(page) {
      const editor = page.querySelector('.editor');
      const header = page.querySelector('.header-area');
      const footer = page.querySelector('.footer-area');

      [editor, header, footer].forEach(el => {
        el.addEventListener('input', (e) => {
          if (el.classList.contains('header-area') || el.classList.contains('footer-area')) {
            this.syncHeadersFooters(el);
          }
          this.checkOverflow(page);
          this._followCursorToNewPage();
          updateCounts();
          markDirty();
        });

        el.addEventListener('keydown', (e) => {
          if (e.key === 'Backspace') {
            const sel = window.getSelection();
            if (sel && sel.isCollapsed && sel.rangeCount > 0) {
              const node = sel.anchorNode;
              const offset = sel.anchorOffset;
              
              let isAtStart = (offset === 0);
              let curr = node;
              while (curr && curr !== editor && isAtStart) {
                  if (curr.previousSibling) isAtStart = false;
                  curr = curr.parentNode;
              }
              if (node === editor && offset === 0) isAtStart = true;

              if (isAtStart) {
                const prevPage = page.previousElementSibling;
                if (prevPage && prevPage.classList.contains('page-container')) {
                  e.preventDefault();
                  const prevEditor = prevPage.querySelector('.editor');
                  
                  const nodeToMove = editor.firstChild;
                  let targetNodeForCursor = prevEditor.lastChild;
                  
                  if (nodeToMove) {
                    if (targetNodeForCursor && targetNodeForCursor.nodeType === 1 && targetNodeForCursor.tagName !== 'BR') {
                      targetNodeForCursor.appendChild(nodeToMove);
                    } else {
                      prevEditor.appendChild(nodeToMove);
                    }
                  }
                  
                  prevEditor.focus();
                  const r = document.createRange();
                  if (nodeToMove) {
                    r.setStartBefore(nodeToMove);
                  } else if (prevEditor.lastChild) {
                    r.setStartAfter(prevEditor.lastChild);
                  } else {
                    r.selectNodeContents(prevEditor);
                  }
                  r.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(r);
                  
                  prevEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  setTimeout(() => {
                    this.checkOverflow(prevPage);
                    this.checkUnderflow(page);
                  }, 10);
                }
              }
            }
          }
          if (e.key === 'Enter') {
            // Enter basılınca hemen overflow kontrolü yap ve odağı taşı
            setTimeout(() => {
              this.checkOverflow(page);
              // Eğer yeni sayfa eklendiyse veya imleç kaydıysa odağı zorla
              this._followCursorToNewPage();
            }, 5);
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            this.insertTab();
          }
        });
      });

      editor.addEventListener('mouseup', updateToolbarState);
      editor.addEventListener('keyup', (e) => {
        if (e.key === 'Backspace' || e.key === 'Delete') {
          this.checkUnderflow(page);
        }
        updateToolbarState();
        updateCounts();
      });
    },

    // checkOverflow sonrası cursor başka sayfaya taşındıysa focus'u takip et
    _followCursorToNewPage() {
      // setTimeout + rAF: DOM güncellendikten sonra selection'ı güvenle okuyabilmek için
      setTimeout(() => {
        requestAnimationFrame(() => {
          const sel = window.getSelection();
          if (!sel || !sel.anchorNode) return;
          let cursorEditor = sel.anchorNode;
          while (cursorEditor && !cursorEditor.classList?.contains('editor')) {
            cursorEditor = cursorEditor.parentElement;
          }
          if (!cursorEditor) return;
          const focusedEl = document.activeElement;
          if (focusedEl && cursorEditor !== focusedEl && cursorEditor.classList.contains('editor')) {
            const anchor = sel.anchorNode;
            const offset = sel.anchorOffset;
            cursorEditor.focus();
            try {
              const r = document.createRange();
              // anchor bir elementse childNodes sayısına bak, text ise length'e
              const maxOffset = (anchor.nodeType === 3) ? (anchor.length || 0) : (anchor.childNodes ? anchor.childNodes.length : 0);
              r.setStart(anchor, Math.min(offset, maxOffset));
              r.collapse(true);
              sel.removeAllRanges();
              sel.addRange(r);
              
              // Scroll to cursor
              if (anchor.nodeType === 1) {
                anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
              } else if (anchor.parentElement) {
                anchor.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            } catch (e) { 
              // Fallback: editor sonuna git
              const r2 = document.createRange();
              r2.selectNodeContents(cursorEditor);
              r2.collapse(false);
              sel.removeAllRanges();
              sel.addRange(r2);
              cursorEditor.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
          }
        });
      }, 50); // DOM güncellemesinin tamamlanması için bekle
    },

    updatePageNumbers() {
      const pages = $$('.page-container');
      pages.forEach((page, i) => {
        const num = page.querySelector('.page-number');
        if (num) num.textContent = `Sayfa ${i + 1} / ${pages.length}`;
      });
    },

    insertTab() {
      const tabSpan = document.createElement('span');
      tabSpan.className = 'udf-tab';
      tabSpan.setAttribute('contenteditable', 'false');
      tabSpan.style.display = 'inline-block';
      tabSpan.style.width = '28pt';
      tabSpan.innerHTML = '&nbsp;'; 
      
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(tabSpan);
        range.setStartAfter(tabSpan);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    },

    syncHeadersFooters(source = null) {
      const allHeaders = $$('.header-area');
      const allFooters = $$('.footer-area');
      
      if (source) {
        const isHeader = source.classList.contains('header-area');
        const content = source.innerHTML;
        const targets = isHeader ? allHeaders : allFooters;
        targets.forEach(t => {
          if (t !== source) t.innerHTML = content;
        });
      } else {
        // Sync all to the first page's content if no source
        const firstHeader = allHeaders[0];
        const firstFooter = allFooters[0];
        if (firstHeader) {
          const hContent = firstHeader.innerHTML;
          allHeaders.forEach(h => h.innerHTML = hContent);
        }
        if (firstFooter) {
          const fContent = firstFooter.innerHTML;
          allFooters.forEach(f => f.innerHTML = fContent);
        }
      }
    },

    checkOverflow(page) {
      const editor = page.querySelector('.editor');
      // Limit total pages to prevent browser crash if something goes wrong
      if ($$('.page-container').length > 200) {
        console.error('Pagination limit reached. Possible infinite loop.');
        return;
      }

      // overflow:hidden yapar scrollHeight=clientHeight. Çocukların toplam yüksekliğini ölç.
      const contentHeight = this._getContentHeight(editor);

      if (contentHeight > this.MAX_EDITOR_HEIGHT && editor.childNodes.length > 0) {
        let nextPage = page.nextElementSibling;
        if (!nextPage || !nextPage.classList.contains('page-container')) {
          nextPage = this.addPage(page);
          // Yeni sayfa eklendiğinde, mevcut header/footer visibility'yi kopyala
          this._syncPageVisibility(page, nextPage);
        }
        this.moveContentForward(page, nextPage);
      }
    },

    _getContentHeight(editor) {
      if (editor.childNodes.length === 0) return 0;
      
      // Range kullanarak içerik yüksekliğini tam olarak ölç
      const range = document.createRange();
      range.selectNodeContents(editor);
      const rects = range.getClientRects();
      
      if (rects.length > 0) {
        // İlk ve son rect arasındaki fark + son rect'in boyutu
        const start = rects[0].top;
        const end = rects[rects.length - 1].bottom;
        return end - start;
      }
      
      // Fallback: scrollHeight (padding dahil olabilir, dikkat)
      return editor.scrollHeight;
    },

    _syncPageVisibility(sourcePage, targetPage) {
      const srcHeader = sourcePage.querySelector('.header-area');
      const srcFooter = sourcePage.querySelector('.footer-area');
      const tgtHeader = targetPage.querySelector('.header-area');
      const tgtFooter = targetPage.querySelector('.footer-area');
      if (srcHeader && tgtHeader) tgtHeader.style.visibility = srcHeader.style.visibility;
      if (srcFooter && tgtFooter) tgtFooter.style.visibility = srcFooter.style.visibility;
    },

    moveContentForward(page, nextPage) {
      const editor = page.querySelector('.editor');
      const nextEditor = nextPage.querySelector('.editor');
      
      const sel = window.getSelection();
      let activeNode = sel.anchorNode;
      let activeOffset = sel.anchorOffset;
      let selectionMoved = false;

      while (this._getContentHeight(editor) > this.MAX_EDITOR_HEIGHT && editor.childNodes.length > 0) {
        const lastChild = editor.lastChild;
        if (activeNode && (lastChild === activeNode || lastChild.contains(activeNode))) {
          selectionMoved = true;
        }
        nextEditor.insertBefore(lastChild, nextEditor.firstChild);
      }
      
      if (selectionMoved) {
        nextEditor.focus();
        const r = document.createRange();
        r.setStart(activeNode, activeOffset);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        
        setTimeout(() => {
          if (activeNode.nodeType === 1) {
            activeNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } else if (activeNode.parentElement) {
            activeNode.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 10);
      }
      
      // If we moved content, check the next page too
      this.checkOverflow(nextPage);
    },

    checkUnderflow(page) {
      const editor = page.querySelector('.editor');
      const nextPage = page.nextElementSibling;
      if (nextPage && nextPage.classList.contains('page-container')) {
        const nextEditor = nextPage.querySelector('.editor');
        
        const sel = window.getSelection();
        let activeNode = sel.anchorNode;
        let activeOffset = sel.anchorOffset;
        let selectionMoved = false;

        while (this._getContentHeight(editor) < this.MAX_EDITOR_HEIGHT - 20 && nextEditor.childNodes.length > 0) {
          const firstChild = nextEditor.firstChild;
          if (activeNode && (firstChild === activeNode || firstChild.contains(activeNode))) {
            selectionMoved = true;
          }
          editor.appendChild(firstChild);
        }
        
        if (selectionMoved) {
          editor.focus();
          const r = document.createRange();
          r.setStart(activeNode, activeOffset);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
          
          setTimeout(() => {
            if (activeNode.nodeType === 1) {
              activeNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (activeNode.parentElement) {
              activeNode.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 10);
        }
        
        if (nextEditor.childNodes.length === 0) {
          const vs = document.getElementById('visualSignatureStamp');
          if (vs && nextPage.contains(vs)) {
            const tmpl = document.getElementById('hidden-templates');
            if (tmpl) tmpl.appendChild(vs);
          }
          nextPage.remove();
          this.updatePageNumbers();
        } else {
          this.checkUnderflow(nextPage);
        }
      }
    },

    getAllContentHTML() {
      const bodies = Array.from($$('.editor')).map(e => e.innerHTML);
      return bodies.join('<div class="page-break-marker"></div>');
    },

    getGlobalHeaderHTML() {
      const h = $('.header-area');
      return h ? h.innerHTML : '';
    },

    getGlobalFooterHTML() {
      const f = $('.footer-area');
      return f ? f.innerHTML : '';
    },

    getFullText() {
      const h = this.getGlobalHeaderHTML().replace(/<[^>]*>/g, '');
      const f = this.getGlobalFooterHTML().replace(/<[^>]*>/g, '');
      const b = Array.from($$('.editor')).map(e => e.innerText).join('\n');
      return h + '\n' + b + '\n' + f;
    },

    loadAllContent(html, header, footer) {
      const wrapper = $('#editorWrapper');
      
      // Rescue visual signature stamp before clearing wrapper
      const visualStamp = document.getElementById('visualSignatureStamp');
      if (visualStamp) {
        const templates = document.getElementById('hidden-templates');
        if (templates) templates.appendChild(visualStamp);
      }
      
      wrapper.innerHTML = '';
      
      const parts = html ? html.split('<div class="page-break-marker"></div>') : [''];
      if (parts.length === 0) parts.push('');

      parts.forEach((part, i) => {
        const page = this.addPage();
        page.querySelector('.editor').innerHTML = part;
        // Header ve footer içeriğini set et; visibility dışarıdan yönetilir (switchTo vb.)
        const hdr = page.querySelector('.header-area');
        const ftr = page.querySelector('.footer-area');
        hdr.innerHTML = header || '';
        ftr.innerHTML = footer || '';
        // Check overflow after content injection
        this.checkOverflow(page);
      });
      this.updatePageNumbers();
    },

    getAllEditorElements() {
      return Array.from($$('.editor'));
    },

    getHeaderArea() {
      return $('.header-area');
    },

    getFooterArea() {
      return $('.footer-area');
    },

    setHeaderVisible(visible) {
      $$('.header-area').forEach(h => {
        h.style.visibility = visible ? 'visible' : 'hidden';
        h.dataset.visible = visible ? 'true' : 'false';
        if (!visible) h.innerHTML = '';
      });
    },

    setFooterVisible(visible) {
      $$('.footer-area').forEach(f => {
        f.style.visibility = visible ? 'visible' : 'hidden';
        f.dataset.visible = visible ? 'true' : 'false';
        if (!visible) f.innerHTML = '';
      });
    },

    isHeaderVisible() {
      const h = $('.header-area');
      return h ? (h.style.visibility !== 'hidden') : false;
    },

    isFooterVisible() {
      const f = $('.footer-area');
      return f ? (f.style.visibility !== 'hidden') : false;
    }
  };

  // Expose PaginationManager for other modules (like udf-manager.js)
  window.PaginationManager = PaginationManager;

  // Initialize Pagination
  PaginationManager.init();

  // ===== Exec Command Helper =====
  function exec(command, value) {
    document.execCommand(command, false, value || null);
    // Focus the active area if it's one of ours
    const active = document.activeElement;
    if (active && (active.classList.contains('editor') || active.classList.contains('header-area') || active.classList.contains('footer-area'))) {
      active.focus();
    } else {
      const activePage = PaginationManager.getActivePage();
      if (activePage) activePage.querySelector('.editor').focus();
    }
    updateToolbarState();
    markDirty();
  }

  // ===== Mark document as modified =====
  function markDirty() {
    const dot = saveStatus.querySelector('.status-dot');
    const text = saveStatus.querySelector('.status-text');
    dot.style.background = 'var(--warning)';
    text.textContent = 'Değiştirildi';
    if (window.udfManagerMarkDirty) window.udfManagerMarkDirty();
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      saveToLocalStorage();
      dot.style.background = 'var(--success)';
      text.textContent = 'Otomatik kaydedildi';
    }, 2000);
  }

  function markSaved() {
    const dot = saveStatus.querySelector('.status-dot');
    const text = saveStatus.querySelector('.status-text');
    dot.style.background = 'var(--success)';
    text.textContent = 'Kaydedildi';
  }

  // ===== Public API — udf-manager.js için =====
  window.parseUdfXmlPublic   = (xml, validationCode) => parseUdfXml(xml, validationCode);
  window.generateUdfXmlPublic= (sig, signerName) => {
    const _saved = [lastSignature, lastSignerName, lastCertDetails];
    lastSignature = sig || null;
    lastSignerName = signerName || null;
    // Keep lastCertDetails as is for generation
    const xml = generateUdfXml();
    lastSignature = _saved[0]; lastSignerName = _saved[1]; lastCertDetails = _saved[2];
    return xml;
  };
  window.setSignatureStatePublic = (sig, name, certDetails) => {
    console.log('[setSignatureStatePublic] sig:', !!sig, '| name:', name, '| certDetails:', certDetails);
    lastSignature   = sig || null;
    lastSignerName  = name || null;
    lastCertDetails = certDetails || null;
    if (window.updateSignedStatus) {
      window.updateSignedStatus(!!sig);
    } else {
      console.warn('[setSignatureStatePublic] updateSignedStatus henüz tanımlı değil');
    }
  };
  window.updateSignedStatusPublic = (isSigned) => {
    if (window.updateSignedStatus) window.updateSignedStatus(isSigned);
  };
  window.updateCountsPublic = () => {
    if (window.updateCounts) window.updateCounts();
  };
  window.showToastPublic = (msg, type) => {
    if (window.showToast) window.showToast(msg, type);
    else console.log('[Toast]', msg, type);
  };

  // ===== LocalStorage Auto-save =====
  function saveToLocalStorage() {
    try {
      const data = {
        title: documentTitle.value,
        content: PaginationManager.getAllContentHTML(),
        header: PaginationManager.getGlobalHeaderHTML(),
        footer: PaginationManager.getGlobalFooterHTML(),
        timestamp: Date.now()
      };
      localStorage.setItem('uyap_editor_autosave', JSON.stringify(data));
    } catch (e) { /* ignore quota errors */ }
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem('uyap_editor_autosave');
      if (raw) {
        const data = JSON.parse(raw);
        documentTitle.value = data.title || 'Adsız Doküman';
        PaginationManager.loadAllContent(data.content || '', data.header || '', data.footer || '');
        markSaved();
        updateCounts();
      }
    } catch (e) { /* ignore */ }
  }

  // ===== Toolbar State Update =====
  function updateToolbarState() {
    toggleActive(btnBold, document.queryCommandState('bold'));
    toggleActive(btnItalic, document.queryCommandState('italic'));
    toggleActive(btnUnderline, document.queryCommandState('underline'));
    toggleActive(btnStrike, document.queryCommandState('strikeThrough'));

    toggleActive(btnAlignLeft, document.queryCommandState('justifyLeft'));
    toggleActive(btnAlignCenter, document.queryCommandState('justifyCenter'));
    toggleActive(btnAlignRight, document.queryCommandState('justifyRight'));
    toggleActive(btnAlignJustify, document.queryCommandState('justifyFull'));

    toggleActive(btnBulletList, document.queryCommandState('insertUnorderedList'));
    toggleActive(btnNumberList, document.queryCommandState('insertOrderedList'));

    const block = document.queryCommandValue('formatBlock');
    if (block) {
      const tag = block.replace('<', '').replace('>', '').toLowerCase();
      selectHeading.value = tag || 'p';
    }
  }

  function toggleActive(btn, state) {
    if (state) btn.classList.add('active');
    else btn.classList.remove('active');
  }

  // ===== Word/Char/Line Count =====
  function updateCounts() {
    const text = PaginationManager.getFullText().trim();

    const words = text ? text.split(/\s+/).length : 0;
    const chars = text.length;
    const lines = text.split('\n').length;
    wordCountEl.textContent = words + ' kelime';
    charCountEl.textContent = chars + ' karakter';
    lineCountEl.textContent = lines + ' satır';
  }

  // ===== Toolbar Button Events =====
  btnUndo.addEventListener('click', () => exec('undo'));
  btnRedo.addEventListener('click', () => exec('redo'));
  btnBold.addEventListener('click', () => exec('bold'));
  btnItalic.addEventListener('click', () => exec('italic'));
  btnUnderline.addEventListener('click', () => exec('underline'));
  btnStrike.addEventListener('click', () => exec('strikeThrough'));

  btnAlignLeft.addEventListener('click', () => exec('justifyLeft'));
  btnAlignCenter.addEventListener('click', () => exec('justifyCenter'));
  btnAlignRight.addEventListener('click', () => exec('justifyRight'));
  btnAlignJustify.addEventListener('click', () => exec('justifyFull'));

  btnBulletList.addEventListener('click', () => exec('insertUnorderedList'));
  btnNumberList.addEventListener('click', () => exec('insertOrderedList'));
  btnIndent.addEventListener('click', () => exec('indent'));
  btnOutdent.addEventListener('click', () => exec('outdent'));

  selectHeading.addEventListener('change', (e) => {
    exec('formatBlock', e.target.value);
  });
  selectFont.addEventListener('change', (e) => {
    exec('fontName', e.target.value);
  });
  selectSize.addEventListener('change', (e) => {
    exec('fontSize', e.target.value);
  });

  // Color pickers
  btnTextColor.addEventListener('click', () => inputTextColor.click());
  inputTextColor.addEventListener('input', (e) => {
    exec('foreColor', e.target.value);
    textColorIndicator.style.background = e.target.value;
  });
  btnHighlight.addEventListener('click', () => inputHighlightColor.click());
  inputHighlightColor.addEventListener('input', (e) => {
    exec('hiliteColor', e.target.value);
    highlightIndicator.style.background = e.target.value;
  });

  // ===== Editor Events (Managed by PaginationManager) =====
  // Will be attached dynamically by PaginationManager

  // Tab key handling for editor and header/footer
  // Managed by PaginationManager

  // ===== Ribbon Tab Switching =====
  function initRibbon() {
    const ribbonTabs = document.querySelector('.ribbon-tabs');
    if (!ribbonTabs) return;

    const panelMap = {
      'dosya': 'panelDosya',
      'giris': 'panelGiris',
      'duzenle': 'panelDuzenle',
      'ekle': 'panelEkle',
      'bichim': 'panelBichim',
      'araclar': 'panelAraclar',
      'goruntum': 'panelGoruntum'
    };

    ribbonTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.ribbon-tab');
      if (!tab) return;

      const tabId = tab.dataset.tab;
      console.log('[Ribbon] Tab clicked:', tabId);

      // 1. All tabs inactive
      document.querySelectorAll('.ribbon-tab').forEach(t => t.classList.remove('active'));
      // 2. All panels hidden
      document.querySelectorAll('.ribbon-panel').forEach(p => {
        p.classList.remove('active');
        p.style.setProperty('display', 'none', 'important');
      });

      // 3. Current tab active
      tab.classList.add('active');
      // 4. Current panel active
      const panelId = panelMap[tabId];
      const panel = document.getElementById(panelId);
      if (panel) {
        panel.classList.add('active');
        panel.style.setProperty('display', 'flex', 'important');
        console.log('[Ribbon] Panel shown:', panelId);
      } else {
        console.warn('[Ribbon] Panel not found:', panelId);
      }
    });
  }
  initRibbon();

  // ===== MODERN UI: Backstage & Quick Access =====
  function initModernUI() {
    const backstageMenu = $('#backstageMenu');
    const btnBackstage = $('#btnBackstage');
    const btnBackstageClose = $('#btnBackstageClose');
    const bsInfoTitle = $('#bsInfoTitle');
    const bsInfoTime = $('#bsInfoTime');
    const bsInfoSigned = $('#bsInfoSigned');

    // Dosya menüsü butonu (yeni ribbon)
    const menuFileBtn = document.getElementById('menuFileBtn');
    const dropdownFileMenu = document.getElementById('dropdownFileMenu');
    if (menuFileBtn && dropdownFileMenu) {
      menuFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdownFileMenu.classList.contains('open');
        closeAllDropdowns();
        if (!isOpen) {
          const rect = menuFileBtn.getBoundingClientRect();
          dropdownFileMenu.style.top = (rect.bottom + 4) + 'px';
          dropdownFileMenu.style.left = rect.left + 'px';
          dropdownFileMenu.classList.add('open');
        }
      });
    }

    // Toggle Backstage (korumalı)
    if (btnBackstage) {
      btnBackstage.addEventListener('click', () => {
        backstageMenu.classList.add('open');
        updateBackstageInfo();
      });
    }
    if (btnBackstageClose) {
      btnBackstageClose.addEventListener('click', () => backstageMenu.classList.remove('open'));
    }

    function updateBackstageInfo() {
      bsInfoTitle.textContent = documentTitle.value || 'Adsız Doküman';
      bsInfoTime.textContent = new Date().toLocaleString('tr-TR');
      bsInfoSigned.textContent = lastSignature ? 'E-İmzalı (' + lastSignerName + ')' : 'İmzalanmamış';
    }

    function triggerGlobalSave() {
      if (window.udfManagerSaveActivePublic) {
        window.udfManagerSaveActivePublic();
      } else {
        $('#actionSaveHTML').click();
      }
    }
    window.triggerGlobalSavePublic = triggerGlobalSave; // Export it for hotkey

    // Quick Access Buttons
    if ($('#qaUndo')) $('#qaUndo').addEventListener('click', () => exec('undo'));
    if ($('#qaRedo')) $('#qaRedo').addEventListener('click', () => exec('redo'));
    if ($('#qaOpen')) $('#qaOpen').addEventListener('click', () => $('#actionOpen').click());
    if ($('#qaSave')) $('#qaSave').addEventListener('click', () => triggerGlobalSave());
    if ($('#qaSign')) $('#qaSign').addEventListener('click', () => {
      const signBtn = $('#actionSignUDF');
      if (signBtn) signBtn.click();
    });

    // Backstage Buttons
    if ($('#bsNew')) $('#bsNew').addEventListener('click', () => { backstageMenu && backstageMenu.classList.remove('open'); $('#actionNew') && $('#actionNew').click(); });
    if ($('#bsOpen')) $('#bsOpen').addEventListener('click', () => { backstageMenu.classList.remove('open'); $('#actionOpen').click(); });
    if ($('#bsSave')) $('#bsSave').addEventListener('click', () => { backstageMenu.classList.remove('open'); triggerGlobalSave(); });
    if ($('#bsSaveAs')) $('#bsSaveAs').addEventListener('click', () => { backstageMenu.classList.remove('open'); $('#actionSaveUDF').click(); });
    if ($('#bsPrint')) $('#bsPrint').addEventListener('click', () => { backstageMenu.classList.remove('open'); window.print(); });
    if ($('#bsExport')) $('#bsExport').addEventListener('click', () => { backstageMenu.classList.remove('open'); $('#actionSavePDF').click(); });
    if ($('#bsExit')) $('#bsExit').addEventListener('click', () => {
      if (confirm('Editörden çıkmak istiyor musunuz? Kaydedilmemiş veriler silinebilir.')) {
        window.location.reload();
      }
    });

    // Theme Toggle from Topbar — direkt toggleTheme() çağrısı aşağıdaki
    // themeButtons döngüsünde yapılıyor; burada ek listener eklenmez.

    // Search Logic
    const qaSearchInput = $('#qaSearchInput');
    if (qaSearchInput) qaSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = e.target.value.trim();
        if (query) {
          if (!window.find(query, false, false, true, false, true, false)) {
              showToast('Metin bulunamadı: ' + query, 'info');
          }
        }
      }
    });
  }
  initModernUI();

  // ===== Harf dönüşümü (Biçim sekmesi) =====
  window.transformCase = function(type) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const text = range.toString();
    let result;
    if (type === 'upper') result = text.toUpperCase();
    else if (type === 'lower') result = text.toLowerCase();
    else result = text.replace(/\b\w/g, c => c.toUpperCase());
    document.execCommand('insertText', false, result);
  };

  // ===== Yapıştır — Clipboard API (execCommand('paste') buton tıklamasında çalışmıyor) =====
  // Tarayıcı güvenliği: buton tıklandığında editör odağını kaybeder, bu yüzden
  // execCommand('paste') silent fail eder. navigator.clipboard.readText() ile
  // içeriği okuyup editöre focus vererek insertText ile yapıştırıyoruz.
  window.pasteFromClipboard = async function() {
    try {
      // Seçili alanı kaydet (buton tıklaması öncesindeki seçim)
      const savedRange = (function() {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) return sel.getRangeAt(0).cloneRange();
        return null;
      })();

      const text = await navigator.clipboard.readText();

      // Editöre focus ver
      const activePage = PaginationManager.getActivePage();
      const editorEl = activePage ? activePage.querySelector('.editor') : $('.editor');
      if (editorEl) editorEl.focus();

      // Kaydedilen seçimi geri yükle
      if (savedRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }

      // Metni ekle
      document.execCommand('insertText', false, text);
      markDirty();
      updateCounts();
    } catch (err) {
      // İzin reddedildi veya pano boş — kullanıcıya bildir
      if (err.name === 'NotAllowedError') {
        showToast('Pano erişim izni reddedildi. Lütfen Ctrl+V kullanın.', 'warning');
      } else {
        // Fallback: editöre focus verip tarayıcının kendi yapıştırmasını dene
        const activePage = PaginationManager.getActivePage();
        const editorEl = activePage ? activePage.querySelector('.editor') : $('.editor');
        if (editorEl) editorEl.focus();
        document.execCommand('paste');
      }
    }
  };

  // ===== UDF panel quickbar button =====
  const btnTogglePanelQ = document.getElementById('btnTogglePanelQ');
  if (btnTogglePanelQ) {
    btnTogglePanelQ.addEventListener('click', () => {
      const btn = document.getElementById('btnTogglePanel');
      if (btn) btn.click();
    });
  }

  // ===== Dropdown Menus (kept for legacy compatibility) =====
  function closeAllDropdowns() {
    document.querySelectorAll('.dropdown-menu').forEach(dd => dd.classList.remove('open'));
    const td = document.getElementById('themeDropdown');
    if (td) td.classList.remove('open');
  }

  document.addEventListener('click', closeAllDropdowns);

  // ===== Araçlar: Hafıza Boşalt =====
  const btnClearMemory = document.getElementById('actionClearMemory');
  if (btnClearMemory) {
    btnClearMemory.addEventListener('click', () => {
      if (confirm('localStorage ve sessionStorage temizlensin mi?\n(Kaydedilmemiş değişiklikler kaybolabilir.)')) {
        localStorage.clear();
        sessionStorage.clear();
        showToast('Hafıza temizlendi.', 'info');
      }
    });
  }

  // ===== Araçlar: Log Başlat/Bitir =====
  let logEnabled = false;
  const btnToggleLog = document.getElementById('actionToggleLog');
  if (btnToggleLog) {
    btnToggleLog.addEventListener('click', () => {
      logEnabled = !logEnabled;
      btnToggleLog.querySelector('.rb-label').innerHTML = logEnabled ? 'Log<br>Bitir' : 'Log<br>Başlat';
      btnToggleLog.classList.toggle('rb-btn-active', logEnabled);
      showToast(logEnabled ? 'Konsol loglama aktif.' : 'Konsol loglama durduruldu.', 'info');
    });
  }

  // ===== Araçlar & Görünüm: Kısayollar / Yardım modal =====
  function showShortcutsModal() {
    let modal = document.getElementById('shortcutsModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'shortcutsModal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;';
      modal.innerHTML = `
        <div style="background:var(--bg-card);border-radius:12px;padding:28px 32px;min-width:420px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.4);color:var(--text-primary);">
          <h3 style="margin:0 0 18px;font-size:16px;font-weight:700;">⌨️ Klavye Kısayolları</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <tr><td style="padding:5px 0;color:var(--text-secondary);">Yeni Doküman</td><td><kbd style="background:var(--bg-hover);padding:2px 7px;border-radius:4px;font-size:11px;">Ctrl+N</kbd></td></tr>
            <tr><td style="padding:5px 0;color:var(--text-secondary);">Aç</td><td><kbd style="background:var(--bg-hover);padding:2px 7px;border-radius:4px;font-size:11px;">Ctrl+O</kbd></td></tr>
            <tr><td style="padding:5px 0;color:var(--text-secondary);">Kaydet</td><td><kbd style="background:var(--bg-hover);padding:2px 7px;border-radius:4px;font-size:11px;">Ctrl+S</kbd></td></tr>
            <tr><td style="padding:5px 0;color:var(--text-secondary);">Bul / Değiştir</td><td><kbd style="background:var(--bg-hover);padding:2px 7px;border-radius:4px;font-size:11px;">Ctrl+H</kbd></td></tr>
            <tr><td style="padding:5px 0;color:var(--text-secondary);">Kalın</td><td><kbd style="background:var(--bg-hover);padding:2px 7px;border-radius:4px;font-size:11px;">Ctrl+B</kbd></td></tr>
            <tr><td style="padding:5px 0;color:var(--text-secondary);">İtalik</td><td><kbd style="background:var(--bg-hover);padding:2px 7px;border-radius:4px;font-size:11px;">Ctrl+I</kbd></td></tr>
            <tr><td style="padding:5px 0;color:var(--text-secondary);">Altı Çizili</td><td><kbd style="background:var(--bg-hover);padding:2px 7px;border-radius:4px;font-size:11px;">Ctrl+U</kbd></td></tr>
            <tr><td style="padding:5px 0;color:var(--text-secondary);">Tümünü Seç</td><td><kbd style="background:var(--bg-hover);padding:2px 7px;border-radius:4px;font-size:11px;">Ctrl+A</kbd></td></tr>
            <tr><td style="padding:5px 0;color:var(--text-secondary);">Geri Al</td><td><kbd style="background:var(--bg-hover);padding:2px 7px;border-radius:4px;font-size:11px;">Ctrl+Z</kbd></td></tr>
            <tr><td style="padding:5px 0;color:var(--text-secondary);">Yazdır</td><td><kbd style="background:var(--bg-hover);padding:2px 7px;border-radius:4px;font-size:11px;">Ctrl+P</kbd></td></tr>
          </table>
          <button onclick="this.closest('#shortcutsModal').remove()" style="margin-top:20px;padding:8px 24px;background:var(--accent-primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">Kapat</button>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    } else {
      modal.remove();
    }
  }

  const btnShowShortcuts = document.getElementById('actionShowShortcuts');
  if (btnShowShortcuts) btnShowShortcuts.addEventListener('click', showShortcutsModal);
  const btnShowHelp = document.getElementById('actionShowHelp');
  if (btnShowHelp) btnShowHelp.addEventListener('click', showShortcutsModal);

  // ===== Görünüm: Seçim / Kelime Bilgisi =====
  const btnWordInfo = document.getElementById('actionWordInfo');
  if (btnWordInfo) {
    btnWordInfo.addEventListener('click', () => {
      const sel = window.getSelection();
      const selText = sel ? sel.toString() : '';
      const allText = PaginationManager.getFullText();
      const words = allText.trim() ? allText.trim().split(/\s+/).length : 0;
      const selWords = selText.trim() ? selText.trim().split(/\s+/).length : 0;
      showToast(`Toplam: ${words} kelime | Seçili: ${selWords} kelime, ${selText.length} karakter`, 'info');
    });
  }

  const btnDocStats = document.getElementById('actionDocStats');
  if (btnDocStats) {
    btnDocStats.addEventListener('click', () => {
      const text = PaginationManager.getFullText() || '';
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const chars = text.length;
      const lines = $$('.editor p, .editor div, .editor br').length;
      let modal = document.getElementById('docStatsModal');
      if (modal) { modal.remove(); return; }
      modal = document.createElement('div');
      modal.id = 'docStatsModal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;';
      modal.innerHTML = `
        <div style="background:var(--bg-card);border-radius:12px;padding:28px 32px;min-width:320px;box-shadow:0 20px 60px rgba(0,0,0,.4);color:var(--text-primary);">
          <h3 style="margin:0 0 18px;font-size:16px;font-weight:700;">📊 Doküman İstatistikleri</h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:8px 0;color:var(--text-secondary);">Kelime Sayısı</td><td style="font-weight:700;text-align:right;">${words}</td></tr>
            <tr><td style="padding:8px 0;color:var(--text-secondary);">Karakter Sayısı</td><td style="font-weight:700;text-align:right;">${chars}</td></tr>
            <tr><td style="padding:8px 0;color:var(--text-secondary);">Paragraf Sayısı</td><td style="font-weight:700;text-align:right;">${lines}</td></tr>
          </table>
          <button onclick="this.closest('#docStatsModal').remove()" style="margin-top:20px;padding:8px 24px;background:var(--accent-primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">Kapat</button>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    });
  }

  // ===== Görünüm: Sürüm Bilgisi =====
  const btnShowVersion = document.getElementById('actionShowVersion');
  if (btnShowVersion) {
    btnShowVersion.addEventListener('click', () => {
      showToast('UYAP Web Doküman Editörü — v1.0 | ArkSignerJS-3.0.2', 'info');
    });
  }

  // ===== Görünüm: Bileşenler Checkbox =====
  const chkRuler = document.getElementById('chkRuler');
  if (chkRuler) {
    chkRuler.addEventListener('change', () => {
      const btn = document.getElementById('actionToggleRuler');
      if (btn) btn.click();
    });
  }
  const chkStatusbar = document.getElementById('chkStatusbar');
  if (chkStatusbar) {
    chkStatusbar.addEventListener('change', () => {
      const btn = document.getElementById('actionToggleStatusbar');
      if (btn) btn.click();
    });
  }
  const chkFilePanel = document.getElementById('chkFilePanel');
  if (chkFilePanel) {
    chkFilePanel.addEventListener('change', () => {
      const btn = document.getElementById('btnTogglePanel');
      if (btn) btn.click();
    });
  }

  // ===== Signed Badge (tek yerde tanımlandı) =====
  window.updateSignedStatus = function(isSigned) {
    try {
      const badge       = document.getElementById('signedBadge');
      const visualStamp = document.getElementById('visualSignatureStamp');
      const visualName  = document.getElementById('visualSignatureName');
      
      if (isSigned) {
        // -- Topbar badge --
        if (badge) {
          badge.style.display = 'flex';
          badge.classList.add('animate-in');
          const textSpan = document.getElementById('signedBadgeText') || badge.lastElementChild;
          if (textSpan) textSpan.textContent = lastSignerName ? 'E-İmzalı: ' + lastSignerName : 'E-İmzalı';
        }
        // -- Görsel mühür (son sayfada) --
        if (visualStamp && visualName) {
          const pages = $$('.page-container');
          const lastPage = pages[pages.length - 1];
          if (lastPage && !lastPage.contains(visualStamp)) {
            lastPage.appendChild(visualStamp);
          }
          visualStamp.style.display = 'flex';
          visualName.textContent = lastSignerName || 'E-İmza Sahibi';
        }
      } else {
        if (badge) {
          badge.style.display = 'none';
          badge.classList.remove('animate-in');
        }
        if (visualStamp) {
          visualStamp.style.display = 'none';
          const templates = document.getElementById('hidden-templates');
          if (templates && !templates.contains(visualStamp)) {
            templates.appendChild(visualStamp);
          }
        }
      }
    } catch (err) {
      console.warn('[updateSignedStatus] hata:', err);
    }
  };
  window.updateSignedStatusPublic = window.updateSignedStatus;

  // ===== Menu Actions =====
  $('#actionNew').addEventListener('click', () => {
    closeAllDropdowns();
    // UDF paneli aktifse yeni belgeyi panele ekle (seçili olanın üzerine yazmaz)
    if (window.udfManagerAddNew) {
      window.udfManagerAddNew();
      return;
    }
    // Fallback: UDF paneli yoksa eski davranış
    if (confirm('Mevcut doküman silinecek. Devam etmek istiyor musunuz?')) {
      PaginationManager.loadAllContent('<p><br></p>', '', '');
      documentTitle.value = 'Adsız Doküman';
      lastSignature = null;
      lastSignerName = null;
      updateSignedStatus(false);
      markSaved();
      updateCounts();
      showToast('Yeni doküman oluşturuldu', 'success');
    }
  });

  $('#btnInsertImageEkle')?.addEventListener('click', () => {
    closeAllDropdowns();
    imageInput.click();
    const activePage = PaginationManager.getActivePage();
    if (activePage) activePage.querySelector('.editor').focus();
  });

  $('#actionOpen').addEventListener('click', async () => {
    closeAllDropdowns();
    const isSecure = window.isSecureContext;
    const fsaOpen = isSecure && typeof window.showOpenFilePicker === 'function';
    if (fsaOpen && window.udfManagerLoadFile) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{
            description: 'UDF Dosyaları',
            accept: { 'application/octet-stream': ['.udf'] }
          }]
        });
        const file = await handle.getFile();
        window.udfManagerLoadFile(file, handle);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();

    // UDF/USF dosyalarını UDF paneline yönlendir (seçili olanın üzerine yazmaz)
    if ((ext === 'udf' || ext === 'usf') && window.udfManagerLoadFile) {
      window.udfManagerLoadFile(file, null);
      fileInput.value = '';
      return;
    }

    if (ext === 'udf' || ext === 'usf') {
      // Fallback: UDF paneli yoksa editöre direkt yükle
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const zip = await JSZip.loadAsync(ev.target.result);
          const contentFile = zip.file('content.xml');
          if (!contentFile) { showToast('content.xml bulunamadı', 'error'); return; }
          const xmlText = await contentFile.async('string');
          const html = parseUdfXml(xmlText);
          PaginationManager.loadAllContent(html.body, html.header, html.footer);
          documentTitle.value = file.name.replace(/\.[^.]+$/, '');
          const sgnFile = zip.file('sign.sgn');
          let sigB64 = null;
          let signerNameFromSgn = null;
          let certDetailsFromSgn = null;

          // Yardımcı: ASN.1 DER formatından detaylı sertifika bilgilerini çek (Bridge kapalıyken fallback)
          const extractDetailedInfoFromP7 = (bytes) => {
            try {
              const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
              
              const extractOidValues = (oid) => {
                let lastPos = 0;
                const values = [];
                while (true) {
                  const idx = hex.indexOf(oid, lastPos);
                  if (idx === -1) break;
                  let start = idx + oid.length;
                  const tag = hex.substring(start, start + 2);
                  let len = parseInt(hex.substring(start + 2, start + 4), 16);
                  let offset = 4;
                  if (len > 128) {
                    const lenBytes = len - 128;
                    len = parseInt(hex.substring(start + 4, start + 4 + (lenBytes * 2)), 16);
                    offset = 4 + (lenBytes * 2);
                  }
                  const contentHex = hex.substring(start + offset, start + offset + (len * 2));
                  let val = '';
                  if (tag === '1e') {
                    for (let i = 0; i < contentHex.length; i += 4) {
                      val += String.fromCharCode(parseInt(contentHex.substring(i, i + 4), 16));
                    }
                  } else {
                    for (let i = 0; i < contentHex.length; i += 2) {
                      val += String.fromCharCode(parseInt(contentHex.substring(i, i + 2), 16));
                    }
                    try { val = decodeURIComponent(escape(val)); } catch(e) {}
                  }
                  if (val.trim()) values.push(val.trim());
                  lastPos = start + offset + (len * 2);
                }
                return values;
              };

              const cns = extractOidValues('0603550403');
              const sns = extractOidValues('0603550405'); // SerialNumber OID (Subject içinde)
              
              const filterKeywords = ['SAĞLAYICI', 'MAKAM', 'HİZMET', 'SERTİFİKA', 'KÖK', 'ROOT', 'BİLİŞİM', 'TÜBİTAK', 'EYP', 'CA ', 'TRUST'];
              const filteredCns = cns.filter(n => !filterKeywords.some(k => n.toUpperCase().includes(k)));
              const personName = filteredCns.find(n => n.includes('(') || (/\d{11}/.test(n))) || filteredCns[0] || cns[0];
              
              const issuerName = cns.find(n => filterKeywords.some(k => n.toUpperCase().includes(k))) || 'E-İmza Hizmet Sağlayıcısı (Bridge Kapalı)';

              // TCKN Maskeleme: 15*******48
              let tckn = sns.find(s => /\d{11}/.test(s)) || cns.find(c => /\d{11}/.test(c)) || '';
              const tcknMatch = tckn.match(/\d{11}/);
              let maskedTckn = '';
              if (tcknMatch) {
                const t = tcknMatch[0];
                maskedTckn = t.substring(0, 2) + "*******" + t.substring(9);
              }

              // Seri No (Certificate Serial Number) - Decimal Gösterim
              let certSerial = '';
              const v3Pattern = 'a00302010202';
              const vIdx = hex.indexOf(v3Pattern);
              if (vIdx !== -1) {
                const lenStart = vIdx + v3Pattern.length;
                let len = parseInt(hex.substring(lenStart, lenStart + 2), 16);
                let offset = 2;
                if (len > 128) {
                    const lb = len - 128;
                    len = parseInt(hex.substring(lenStart + 2, lenStart + 2 + (lb * 2)), 16);
                    offset = 2 + (lb * 2);
                }
                const serialHex = hex.substring(lenStart + offset, lenStart + offset + (len * 2));
                if (serialHex) {
                  try {
                    certSerial = BigInt("0x" + serialHex).toString();
                  } catch(e) {
                    certSerial = serialHex.toUpperCase().match(/.{1,2}/g).join(':');
                  }
                }
              }

              if (!certSerial) {
                certSerial = sns.find(s => !/\d{11}/.test(s)) || 'Ayrıştırılamadı (Bridge Kapalı)';
              }

              // Tarihleri çek (UTCTime 17 veya GeneralizedTime 18)
              const extractDate = (startIdx) => {
                const tag = hex.substring(startIdx, startIdx + 2);
                const len = parseInt(hex.substring(startIdx + 2, startIdx + 4), 16);
                const content = hex.substring(startIdx + 4, startIdx + 4 + (len * 2));
                let str = '';
                for (let i = 0; i < content.length; i += 2) str += String.fromCharCode(parseInt(content.substring(i, i + 2), 16));
                
                let year, month, day, hour, min, sec;
                if (tag === '17') {
                    year = parseInt(str.substring(0, 2));
                    year += (year < 50 ? 2000 : 1900);
                    month = str.substring(2, 4); day = str.substring(4, 6);
                    hour = str.substring(6, 8); min = str.substring(8, 10); sec = str.substring(10, 12);
                } else {
                    year = str.substring(0, 4); month = str.substring(4, 6); day = str.substring(6, 8);
                    hour = str.substring(8, 10); min = str.substring(10, 12); sec = str.substring(12, 14);
                }
                return `${year}-${month}-${day}T${hour}:${min}:${sec}Z`;
              };

              let validFrom = null, validTo = null;
              const timeIdx = hex.indexOf('170d');
              if (timeIdx !== -1) {
                  validFrom = extractDate(timeIdx);
                  const nextIdx = hex.indexOf('170d', timeIdx + 10);
                  if (nextIdx !== -1) validTo = extractDate(nextIdx);
              }
              
              return {
                signerName: personName,
                certDetails: {
                  subject: personName,
                  issuer: issuerName,
                  serial: certSerial,
                  identityNo: maskedTckn,
                  validFrom: validFrom,
                  validTo: validTo
                }
              };
            } catch (e) { console.error('P7 Parse Error:', e); }
            return { signerName: 'E-İmzalı Doküman', certDetails: null };
          };

          if (sgnFile) {
            showToast('Bu doküman imzalanmış (sign.sgn mevcut)', 'info');
            const sigBytes = await sgnFile.async('uint8array');
            let binary = '';
            for (let i = 0; i < sigBytes.byteLength; i++) binary += String.fromCharCode(sigBytes[i]);
            sigB64 = window.btoa(binary);

            // Varsayılan bilgiler — bridge'den cevap gelmezse bunlar görünecek
            const p7Info = extractDetailedInfoFromP7(sigBytes);
            signerNameFromSgn = p7Info.signerName;
            certDetailsFromSgn = p7Info.certDetails;

            try {
              // Eğer HTTPS'deyseniz HTTP localhost isteği Mixed Content engeline takılabilir
              const res = await fetch('http://127.0.0.1:5005/parse_signature', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ signature: sigB64 })
              });
              if (res.ok) {
                const data = await res.json();
                if (data.success) {
                  signerNameFromSgn = data.signerName;
                  certDetailsFromSgn = data.certDetails;
                }
              }
            } catch (e) {
              console.warn('Sertifika ayrıştırma servisine erişilemedi (Tarayıcı içi parser kullanıldı):', e);
            }
          }
          lastSignature = sigB64;
          lastSignerName = signerNameFromSgn;
          lastCertDetails = certDetailsFromSgn;
          updateSignedStatus(!!sigB64);
          
          markSaved(); updateCounts();
          showToast(file.name + ' açıldı', 'success');
        } catch (err) {
          showToast('UDF dosyası okunamadı: ' + err.message, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target.result;
        if (ext === 'json') {
          try {
            const data = JSON.parse(content);
            PaginationManager.loadAllContent(data.content || '', '', '');
            documentTitle.value = data.title || file.name;
          } catch { PaginationManager.loadAllContent(content, '', ''); }
        } else {
          PaginationManager.loadAllContent(content, '', '');
          documentTitle.value = file.name.replace(/\.[^.]+$/, '');
        }
        lastSignature = null; lastSignerName = null;
        updateSignedStatus(false);
        markSaved(); updateCounts();
        showToast(file.name + ' açıldı', 'success');
      };
      reader.readAsText(file);
    }
    fileInput.value = '';
  });

  // ===== UDF XML Parser =====
  function parseUdfXml(xmlText, validationCode) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    const contentEl = xmlDoc.querySelector('template > content');
    const rawText = contentEl ? contentEl.textContent : '';

    const styles = {};
    xmlDoc.querySelectorAll('styles > style').forEach(s => {
      styles[s.getAttribute('name')] = {
        family: s.getAttribute('family'),
        size: s.getAttribute('size'),
        bold: s.getAttribute('bold') === 'true',
        italic: s.getAttribute('italic') === 'true',
        underline: s.getAttribute('underline') === 'true',
        alignment: s.getAttribute('Alignment') || s.getAttribute('alignment'),
        tabSet: s.getAttribute('TabSet'),
        leftIndent: s.getAttribute('LeftIndent'),
        firstLineIndent: s.getAttribute('FirstLineIndent'),
        rightIndent: s.getAttribute('RightIndent'),
        spaceBefore: s.getAttribute('SpaceBefore'),
        spaceAfter: s.getAttribute('SpaceAfter'),
        lineSpacing: s.getAttribute('LineSpacing')
      };
    });

    let barcodeFound = false;
    let barcodeData = '';

    function parseElements(containerNode) {
      if (!containerNode) return '';
      const paragraphs = containerNode.querySelectorAll(':scope > paragraph');
      let html = '';

      paragraphs.forEach(para => {
        const resolver = para.getAttribute('resolver') || '';
        const style = styles[resolver] || styles['hvl-default'] || { family: 'Times New Roman', size: '12' };

        const alignment = para.getAttribute('Alignment') || style.alignment;
        const leftIndent = parseFloat(para.getAttribute('LeftIndent') || style.leftIndent || '0');
        const firstLineIndent = parseFloat(para.getAttribute('FirstLineIndent') || style.firstLineIndent || '0');
        const rightIndent = para.getAttribute('RightIndent') || style.rightIndent;
        const spaceBefore = para.getAttribute('SpaceBefore') || style.spaceBefore;
        const spaceAfter = para.getAttribute('SpaceAfter') || style.spaceAfter;
        const lineSpacing = para.getAttribute('LineSpacing') || style.lineSpacing;
        let paraHtml = '';
        const tabSetRaw = para.getAttribute('TabSet') || style.tabSet || '';
        const tabStopsRaw = tabSetRaw.split(',').filter(s => s.trim() !== '');
        const tabStops = tabStopsRaw.map(s => {
          const parts = s.split(':');
          return {
            pos: parseFloat(parts[0]),
            align: parts[1] || '0', // 0:Left, 1:Center, 2:Right
            leader: parts[2] || '0'
          };
        });
        
        let lastX = leftIndent + firstLineIndent;
        let currentFieldHtml = '';
        let currentFieldStop = null;
        let currentFontSize = 12;

        function flushField(nextStopObj) {
          if (currentFieldStop) {
            // This field was created by a previous tab and ends at currentFieldStop
            const width = Math.max(0, currentFieldStop.pos - lastX);
            let cellStyle = `display:inline-block; min-height:1em; min-width:${width}pt; vertical-align:top;`;
            if (currentFieldStop.align === '2') cellStyle += `text-align:right; width:${width}pt;`;
            else if (currentFieldStop.align === '1') cellStyle += `text-align:center; width:${width}pt;`;
            
            paraHtml += `<span class="udf-cell" style="${cellStyle}">${currentFieldHtml || '&nbsp;'}</span>`;
            lastX = currentFieldStop.pos;
          } else {
            // Initial field before any tabs
            paraHtml += `<span>${currentFieldHtml}</span>`;
            const textContent = currentFieldHtml.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
            const charWidth = (currentFontSize / 12) * 6.0;
            lastX += textContent.length * charWidth;
          }
          currentFieldHtml = '';
          currentFieldStop = nextStopObj;
        }

        const segmentEls = para.querySelectorAll(':scope > content, :scope > field, :scope > space, :scope > tab, :scope > barcode, :scope > image, :scope > picture');

        segmentEls.forEach(ce => {
          const tagName = ce.tagName.toLowerCase();
          
          if (tagName === 'tab') {
            let nextStop = null;
            for (let i = 0; i < tabStops.length; i++) {
              if (tabStops[i].pos > lastX + 0.5) {
                nextStop = tabStops[i];
                break;
              }
            }
            if (!nextStop) {
              nextStop = { pos: lastX + 36, align: '0' };
            }
            flushField(nextStop);
          } else if (tagName === 'barcode') {
            barcodeFound = true;
            barcodeData = ce.getAttribute('code') || ce.textContent || '';
            currentFieldHtml += `<div class="udf-barcode-qr" title="Barkod: ${barcodeData}"></div>`;
          } else if (tagName === 'image' || tagName === 'picture') {
            const data = ce.getAttribute('data') || ce.textContent || '';
            if (data && data.length > 20) {
              const mime = data.startsWith('IVBOR') ? 'image/png' : 'image/jpeg';
              currentFieldHtml += `<img src="data:${mime};base64,${data}" style="max-width:100%; height:auto; display:inline-block; vertical-align:middle;">`;
            }
          } else {
            const startOffset = parseInt(ce.getAttribute('startOffset') || '0');
            const length = parseInt(ce.getAttribute('length') || '0');
            const resolver = ce.getAttribute('resolver');
            
            let segment = '';
            if (tagName === 'content' || tagName === 'field') {
              segment = rawText.substring(startOffset, startOffset + length);
            } else if (tagName === 'space') {
              segment = ' '.repeat(length || 1);
            }

            const style = styles[resolver] || {};
            const fontSize = ce.getAttribute('size') || style.size;
            if (fontSize) currentFontSize = parseFloat(fontSize);

            const isBold = ce.getAttribute('bold') === 'true' || style.bold;
            const isItalic = ce.getAttribute('italic') === 'true' || style.italic;
            const isUnderline = ce.getAttribute('underline') === 'true' || style.underline;
            const fontFamily = ce.getAttribute('family') || style.family;
            const foreground = ce.getAttribute('foreground');

            let inlineStyles = '';
            if (isBold) inlineStyles += 'font-weight:bold;';
            if (isItalic) inlineStyles += 'font-style:italic;';
            if (isUnderline) inlineStyles += 'text-decoration:underline;';
            if (fontFamily) inlineStyles += `font-family:'${fontFamily}';`;
            if (fontSize) inlineStyles += `font-size:${fontSize}pt;`;
            if (foreground) {
               if (foreground === '-196608') inlineStyles += 'color:#ef4444;';
               else if (foreground === '-16777216') inlineStyles += 'color:#000;';
            }

            const parts = segment.split('\t');
            parts.forEach((part, pIdx) => {
              if (pIdx > 0) {
                let nextStop = null;
                for (let i = 0; i < tabStops.length; i++) {
                  if (tabStops[i].pos > lastX + 0.5) {
                    nextStop = tabStops[i];
                    break;
                  }
                }
                if (!nextStop) nextStop = { pos: lastX + 36, align: '0' };
                flushField(nextStop);
              }
              const spanContent = part.replace(/\n/g, '<br>').replace(/ /g, '&nbsp;');
              currentFieldHtml += inlineStyles ? `<span style="${inlineStyles}">${spanContent}</span>` : spanContent;
            });
          }
        });
        flushField(null);
        paraHtml += currentFieldHtml;

        let pStyle = 'margin:0; padding:0; min-height:1.2em; position:relative; ';
        const alignMap = { '1': 'center', '2': 'right', '3': 'justify' };
        if (alignment && alignMap[alignment]) pStyle += `text-align:${alignMap[alignment]};`;
        if (firstLineIndent) pStyle += `text-indent:${firstLineIndent}pt;`;
        if (leftIndent) pStyle += `margin-left:${leftIndent}pt;`;
        if (rightIndent) pStyle += `margin-right:${parseFloat(rightIndent)}pt;`;
        if (spaceBefore) pStyle += `margin-top:${parseFloat(spaceBefore)}pt;`;
        if (spaceAfter) pStyle += `margin-bottom:${parseFloat(spaceAfter)}pt;`;
        if (lineSpacing) {
          const ls = parseFloat(lineSpacing);
          if (ls > 0) {
            const normalizedLS = ls > 5 ? ls / 10 : ls;
            pStyle += `line-height:${normalizedLS};`;
          }
        }
        if (style.family) pStyle += `font-family:'${style.family}';`;
        if (style.size) pStyle += `font-size:${style.size}pt;`;

        const styleAttr = pStyle ? ` style="${pStyle}"` : '';
        const trimmed = paraHtml.replace(/<[^>]*>/g, '').trim();
        html += (!trimmed || trimmed === '\n' || !paraHtml) ? `<p${styleAttr}><br></p>` : `<p${styleAttr}>${paraHtml}</p>`;
      });
      return html;
    }

    const bodyNode = xmlDoc.querySelector('template > elements');
    const headerNode = xmlDoc.querySelector('header');
    const footerNode = xmlDoc.querySelector('footer');
    const webIdNode = xmlDoc.querySelector('webID');
    const webId = webIdNode ? webIdNode.getAttribute('id') : '';

    const extraNodes = Array.from(xmlDoc.querySelectorAll('template > *')).filter(node => 
      !['styles', 'content', 'elements', 'header', 'footer', 'properties', 'webid'].includes(node.tagName.toLowerCase())
    );
    
    let extraFooterContent = '';
    extraNodes.forEach(node => {
      extraFooterContent += parseElements(node.querySelector('elements') || node);
    });

    const headerContent = headerNode ? parseElements(headerNode.querySelector('elements') || headerNode) : '';
    const footerContent = footerNode ? parseElements(footerNode.querySelector('elements') || footerNode) : '';

    const vCode = validationCode || webId;
    if (vCode && !barcodeFound) {
      extraFooterContent += `
        <div style="position:relative; margin-top:10pt; border-top:1px solid #000; padding-top:4pt;">
          <div style="float:right; margin-left:10pt;">
             <div class="udf-barcode-qr" style="width:40pt; height:40pt;" title="WebID: ${vCode}"></div>
          </div>
          <div style="font-size:8pt; line-height:1.4;">
            UYAP Bilişim Sistemindeki bu dokümana http://vatandas.uyap.gov.tr adresinden ${vCode} ile erişebilirsin.
          </div>
          <div style="clear:both;"></div>
        </div>`;
    } else if (webId) {
      extraFooterContent += `
        <div style="margin-top:8pt; border-top:1.5pt solid #000; padding-top:2pt; font-size:8pt;">
          UYAP Bilişim Sistemindeki bu dokümana http://vatandas.uyap.gov.tr adresinden ${webId} ile erişebilirsin.
        </div>`;
    }

    return {
      body: parseElements(bodyNode) || `<p>${rawText.replace(/\n/g, '</p><p>')}</p>`,
      header: headerContent,
      footer: footerContent + extraFooterContent,
      hasHeader: !!headerNode,
      hasFooter: !!footerNode || !!extraFooterContent || !!vCode
    };
  }

  // ===== UDF XML Generator =====
  function generateUdfXml() {
    let rawText = '';
    let currentOffset = 0;

    function extractSegments(node, currentStyle, segments) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent) segments.push({ type: 'text', text: node.textContent, style: currentStyle });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'BR') { segments.push({ type: 'text', text: '\n', style: currentStyle }); return; }
        if (node.classList.contains('udf-tab')) { segments.push({ type: 'tab', style: currentStyle }); return; }
        
        let newStyle = { ...currentStyle };
        if (node.tagName === 'B' || node.tagName === 'STRONG') newStyle.bold = true;
        if (node.tagName === 'I' || node.tagName === 'EM') newStyle.italic = true;
        if (node.style.fontFamily) newStyle.family = node.style.fontFamily.replace(/['"]/g, '');
        if (node.style.fontSize) newStyle.size = parseInt(node.style.fontSize);
        
        for (let child of node.childNodes) extractSegments(child, newStyle, segments);
      }
    }

    function generateContainerXml(containerEl) {
      if (!containerEl) return '';
      let xml = '';
      const blocks = Array.from(containerEl.childNodes);
      if (blocks.length === 0) return '';

      blocks.forEach(block => {
        let segments = [];
        let align = '';
        if (block.nodeType === Node.ELEMENT_NODE) {
          if (block.style.textAlign === 'center') align = '1';
          else if (block.style.textAlign === 'right') align = '2';
          else if (block.style.textAlign === 'justify') align = '3';
          extractSegments(block, {}, segments);
        } else if (block.nodeType === Node.TEXT_NODE) {
          if (block.textContent.trim() === '') return;
          extractSegments(block, {}, segments);
        }

        segments.push({ text: '\n', style: {} });
        const alignAttr = align ? ` Alignment="${align}"` : '';
        xml += `<paragraph resolver="hvl-default"${alignAttr}>`;

        segments.forEach(seg => {
          let styleAttrs = '';
          if (seg.style.bold) styleAttrs += ' bold="true"';
          if (seg.style.italic) styleAttrs += ' italic="true"';
          if (seg.style.family) styleAttrs += ` family="${seg.style.family}"`;
          if (seg.style.size) styleAttrs += ` size="${seg.style.size}"`;

          if (seg.type === 'tab') {
            xml += `<tab startOffset="${currentOffset}" length="1"${styleAttrs} />`;
            rawText += '\t';
            currentOffset += 1;
          } else {
            let len = seg.text.length;
            rawText += seg.text;
            xml += `<content startOffset="${currentOffset}" length="${len}"${styleAttrs} />`;
            currentOffset += len;
          }
        });
        xml += `</paragraph>\n`;
      });
      return xml;
    }

    const tempDiv = document.createElement('div');
    PaginationManager.getAllEditorElements().forEach(e => {
      e.childNodes.forEach(child => tempDiv.appendChild(child.cloneNode(true)));
    });

    const bodyXml = generateContainerXml(tempDiv) || '<paragraph resolver="hvl-default"><content startOffset="0" length="0" /></paragraph>';
    
    const h = PaginationManager.getHeaderArea();
    const f = PaginationManager.getFooterArea();
    const headerContentXml = generateContainerXml(h);
    const footerContentXml = generateContainerXml(f);

    const headerXml = (h && h.style.display !== 'none' && headerContentXml) ? `<header><elements>\n${headerContentXml}</elements></header>\n` : '';
    const footerXml = (f && f.style.display !== 'none' && footerContentXml) ? `<footer><elements>\n${footerContentXml}</elements></footer>\n` : '';

    const safeRawText = rawText.replace(/\]\]>/g, ']]]]><![CDATA[>');
    const isSigned = lastSignature ? ' signed="true"' : '';
    let signatureElement = '';
    if (lastSignature && lastSignerName) {
      signatureElement = `<signature name="${lastSignerName}" date="${new Date().toLocaleString('tr-TR')}" />\n`;
    }

    return `<?xml version="1.0" encoding="UTF-8" ?>
<template format_id="1.8"${isSigned} >
<content><![CDATA[${safeRawText}]]></content>
<properties><pageFormat mediaSizeName="1" leftMargin="70.875" rightMargin="70.875" topMargin="70.875" bottomMargin="70.875" paperOrientation="1" headerFOffset="20.0" footerFOffset="20.0" /></properties>
${headerXml}${footerXml}<elements>
${bodyXml}${signatureElement}</elements>
<styles>
<style name="hvl-default" family="Times New Roman" description="Gövde" size="12" />
</styles>
</template>`;
  }

  // ===== String → Base64 (UTF-8 bytes) =====
  // cades.sign, dataBase64 parametresini "imzalanacak ham veri" olarak alır.
  // Hash'i kendisi hesaplar and CAdES MessageDigest attribute'una yazar.
  // Bu yüzden SHA-256 hash değil, content.xml'in kendisini base64 olarak geçiriyoruz.
  function xmlToBase64(str) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    let binaryStr = '';
    for (let i = 0; i < bytes.length; i++) {
      binaryStr += String.fromCharCode(bytes[i]);
    }
    return btoa(binaryStr);
  }

  // ===== Base64 → Uint8Array (binary) =====
  function base64ToUint8Array(b64) {
    const binaryStr = atob(b64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    return bytes;
  }

  // ===== UDF İndirme (imzalı veya imzasız) =====
  // preGeneratedXml: imzalamada kullanılan XML'i tekrar üretmemek için dışarıdan alınır.
  // Aksi takdirde lastSignature dolduğunda XML farklı üretilir → hash uyuşmaz.
  async function downloadUdf(withSignature, preGeneratedXml) {
    if (!window.JSZip) { showToast('ZIP kütüphanesi yüklenemedi', 'error'); return; }
    const title = documentTitle.value || 'dokuman';
    try {
      const xmlContent = preGeneratedXml || generateUdfXml();
      const zip = new JSZip();
      zip.file('content.xml', xmlContent);

      if (withSignature && lastSignature) {
        // signedMime → binary → sign.sgn (PKCS#7/CMS formatında)
        try {
          const signBytes = base64ToUint8Array(lastSignature);
          zip.file('sign.sgn', signBytes);
        } catch (e) {
          console.error('İmza binary dönüşüm hatası:', e);
          showToast('İmza verisi dönüştürülemedi, imzasız kaydediliyor', 'error');
        }
      }

      // Mobil tarayıcı düzeltmesi:
      // JSZip { type: 'blob' } → MIME type = 'application/zip' üretir.
      // Android Chrome ve iOS Safari ZIP magic byte'larını (PK\x03\x04) tespit
      // edip .udf uzantısını .zip olarak değiştirir.
      // Çözüm: önce Uint8Array al, sonra 'application/octet-stream' ile Blob oluştur.
      // octet-stream = "bu binary veridir, dosya türünü sen belirleme" anlamına gelir.
      const zipBytes = await zip.generateAsync({ type: 'uint8array' });
      const blob = new Blob([zipBytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = title + '.udf';
      a.click();
      URL.revokeObjectURL(url);
      markSaved();
      const msg = withSignature && lastSignature ? title + '.udf imzalı olarak indirildi' : title + '.udf indirildi';
      showToast(msg, 'success');
    } catch (err) {
      console.error(err);
      showToast('UDF oluşturulurken hata: ' + err.message, 'error');
    }
  }

  // ===== KAYDET — direkt UDF olarak indir =====
  $('#btnInsertTableEkle')?.addEventListener('click', () => {
    closeAllDropdowns();
    // insertTable function needs to be context aware or use a global helper
    const activePage = PaginationManager.getActivePage();
    if (activePage) {
        // Example: logic to insert table at current focus
        activePage.querySelector('.editor').focus();
        openTableDialog();
    }
  });

  $('#actionSaveHTML').addEventListener('click', () => {
    closeAllDropdowns();
    downloadUdf(false);
    markSaved();
  });

  // ===== FARKLI KAYDET — UDF / PDF seçim modalı =====
  function showSaveAsDialog() {
    closeAllDropdowns();
    let modal = document.getElementById('saveAsModal');
    if (modal) { modal.remove(); return; }
    modal = document.createElement('div');
    modal.id = 'saveAsModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:var(--bg-card);border-radius:16px;padding:32px 36px;min-width:360px;box-shadow:0 24px 64px rgba(0,0,0,.45);color:var(--text-primary);">
        <h3 style="margin:0 0 8px;font-size:17px;font-weight:700;">Farklı Kaydet</h3>
        <p style="margin:0 0 24px;font-size:13px;color:var(--text-secondary);">Dosya formatını seçin:</p>
        <div style="display:flex;gap:14px;">
          <button id="saveAsUDF" style="flex:1;padding:16px 12px;border:2px solid var(--accent-primary);background:var(--accent-light);border-radius:12px;cursor:pointer;color:var(--accent-primary);font-weight:700;font-size:14px;display:flex;flex-direction:column;align-items:center;gap:8px;transition:.2s;">
            <span class="material-icons-outlined" style="font-size:32px;">folder_zip</span>
            UDF Dosyası
            <span style="font-size:11px;font-weight:400;color:var(--text-secondary);">UYAP Doküman Formatı</span>
          </button>
          <button id="saveAsPDF" style="flex:1;padding:16px 12px;border:2px solid #e53935;background:#fff5f5;border-radius:12px;cursor:pointer;color:#e53935;font-weight:700;font-size:14px;display:flex;flex-direction:column;align-items:center;gap:8px;transition:.2s;">
            <span class="material-icons-outlined" style="font-size:32px;">picture_as_pdf</span>
            PDF Dosyası
            <span style="font-size:11px;font-weight:400;color:var(--text-secondary);">Yazdırma / Arşiv</span>
          </button>
        </div>
        <button onclick="this.closest('#saveAsModal').remove()" style="margin-top:20px;width:100%;padding:9px;background:transparent;border:1px solid var(--border-color);border-radius:8px;cursor:pointer;font-size:13px;color:var(--text-secondary);">İptal</button>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#saveAsUDF').addEventListener('click', () => {
      modal.remove();
      downloadUdf(false);
      markSaved();
    });
    modal.querySelector('#saveAsPDF').addEventListener('click', () => {
      modal.remove();
      savePDF();
    });
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }

  $('#actionSaveUDF').addEventListener('click', showSaveAsDialog);

  // ===== PDF KAYDET — tarayıcı print diyaloğu ile =====
  async function savePDF() {
    if (!window.jspdf || !window.html2canvas) {
      showToast('PDF kütüphanesi yükleniyor, lütfen bekleyin...', 'info');
      return;
    }
    const title = documentTitle.value || 'dokuman';
    showToast('PDF hazırlanıyor...', 'info');

    try {
      // Exporting multi-page to PDF is complex with html2canvas. 
      // We'll export the wrapper which contains all pages.
      const canvas = await html2canvas(document.body, { // Simplified for demo
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      });

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ format: 'a4', unit: 'mm', orientation: 'portrait' });

      const pageW  = pdf.internal.pageSize.getWidth();
      const pageH  = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const contentW = pageW - 2 * margin;
      const contentH = pageH - 2 * margin;

      const pxPerMm = canvas.width / contentW;
      const totalMmHeight = canvas.height / pxPerMm;
      const totalPages = Math.ceil(totalMmHeight / contentH);

      const imgData = canvas.toDataURL('image/jpeg', 0.95);

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) pdf.addPage();
        const yOffset = margin - page * contentH;
        pdf.addImage(imgData, 'JPEG', margin, yOffset, contentW, totalMmHeight);
      }

      pdf.save(title + '.pdf');
      showToast('✓ PDF indirildi: ' + title + '.pdf', 'success');
    } catch (err) {
      console.error('PDF hatası:', err);
      showToast('PDF oluşturulamadı: ' + err.message, 'error');
    }
  }

  const btnSavePDF = document.getElementById('actionSavePDF');
  if (btnSavePDF) btnSavePDF.addEventListener('click', () => { closeAllDropdowns(); savePDF(); });

  // ===== JSON Kaydet =====
  $('#actionSaveJSON').addEventListener('click', () => {
    closeAllDropdowns();
    const title = documentTitle.value || 'dokuman';
    const data = JSON.stringify({ title, content: PaginationManager.getAllContentHTML(), savedAt: new Date().toISOString() }, null, 2);
    downloadFile(data, title + '.json', 'application/json');
  });

  // ===== TXT Kaydet =====
  $('#actionSaveTXT').addEventListener('click', () => {
    closeAllDropdowns();
    const title = documentTitle.value || 'Adsız Doküman';
    downloadFile(PaginationManager.getFullText(), title + '.txt', 'text/plain');
  });

  $('#actionPrint').addEventListener('click', () => {
    closeAllDropdowns();
    window.print();
  });

  // ===== downloadFile yardımcısı =====
  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    markSaved();
    showToast(filename + ' indirildi', 'success');
  }

  // ===================================================
  // ===== ArkSigner E-İmza Entegrasyonu =====
  // ===================================================
  //
  // PIN modal'ı için yardımcı — tarayıcı prompt() yerine modal kullanır
  function showPinModal(signerName) {
    return new Promise((resolve) => {
      const existing = document.getElementById('pinModal');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'pinModal';
      overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.6);
        z-index:9999;display:flex;align-items:center;justify-content:center;
      `;

      overlay.innerHTML = `
        <div style="background:var(--bg-elevated,#fff);border-radius:12px;padding:28px 32px;min-width:320px;max-width:400px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
            <span class="material-icons-outlined" style="color:var(--accent,#4f46e5);font-size:28px;">lock</span>
            <h3 style="margin:0;font-size:16px;font-weight:600;color:var(--text-primary,#1a1a2e);">E-İmza PIN Girişi</h3>
          </div>
          <p style="margin:0 0 8px;font-size:13px;color:var(--text-muted,#64748b);">Sertifika: <strong>${signerName || 'E-İmza Sahibi'}</strong></p>
          <p style="margin:0 0 16px;font-size:12px;color:var(--text-muted,#64748b);">Akıllı kartınızın PIN kodunu girin:</p>
          <input id="pinInput" type="password" autocomplete="off" placeholder="PIN..." style="width:100%;box-sizing:border-box;padding:10px 14px;border:1.5px solid var(--border,#e2e8f0);border-radius:8px;font-size:18px;letter-spacing:4px;background:var(--bg-primary,#f8fafc);color:var(--text-primary,#1a1a2e);outline:none;">
          <div id="pinError" style="color:#ef4444;font-size:12px;margin-top:6px;min-height:16px;"></div>
          <div style="display:flex;gap:10px;margin-top:16px;justify-content:flex-end;">
            <button id="pinCancel" style="padding:9px 20px;border-radius:8px;border:1.5px solid var(--border,#e2e8f0);background:transparent;cursor:pointer;font-size:13px;font-weight:500;color:var(--text-primary,#1a1a2e);">İptal</button>
            <button id="pinConfirm" style="padding:9px 20px;border-radius:8px;border:none;background:var(--accent,#4f46e5);cursor:pointer;font-size:13px;font-weight:600;color:#fff;">İmzala</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      const pinInput = document.getElementById('pinInput');
      const pinError = document.getElementById('pinError');
      pinInput.focus();

      function confirm() {
        const pin = pinInput.value;
        if (!pin || pin.length < 4) {
          pinError.textContent = 'PIN en az 4 karakter olmalı';
          pinInput.focus();
          return;
        }
        overlay.remove();
        resolve(pin);
      }

      function cancel() {
        overlay.remove();
        resolve(null);
      }

      document.getElementById('pinConfirm').addEventListener('click', confirm);
      document.getElementById('pinCancel').addEventListener('click', cancel);
      pinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirm();
        if (e.key === 'Escape') cancel();
      });
    });
  }

  // ===== YEREL KÖPRÜ (LOCAL BRIDGE) ENTEGRASYONU =====
  const BRIDGE_URL = "http://127.0.0.1:5005";

  // Bridge durumunu kontrol et (sadece bilgi, butonları devre dışı bırakmaz)
  async function checkBridgeStatus() {
    try {
      const resp = await fetch(`${BRIDGE_URL}/list-certs`, { signal: AbortSignal.timeout(2000) });
      const data = await resp.json();
      const hasCard = data.success && data.certs && data.certs.length > 0;
      console.log('[Bridge]', hasCard ? `Kart bağlı: ${data.certs[0].label}` : 'Servis açık, kart yok');
    } catch {
      console.log('[Bridge] Servis kapalı');
    }
  }

  // İmzalama butonu
  const _signBtn = document.getElementById('actionSignUDF');
  if (_signBtn) _signBtn.addEventListener('click', async () => {
    closeAllDropdowns();
    try {
      showToast('Kart kontrol ediliyor...', 'info');
      const certResp = await fetch(`${BRIDGE_URL}/list-certs`, { signal: AbortSignal.timeout(3000) });
      const certData = await certResp.json();
      if (!certData.success || certData.certs.length === 0) {
        throw new Error('Akıllı kart bulunamadı veya yerel servis çalışmıyor.');
      }
      const terminal = certData.certs[0];
      const pin = await showPinModal(terminal.label);
      if (!pin) return;
      showToast('Doküman imzalanıyor...', 'info');
      const xmlContent = generateUdfXml();
      const dataBase64 = xmlToBase64(xmlContent);
      const signResp = await fetch(`${BRIDGE_URL}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, slotId: terminal.slotId, data: dataBase64 })
      });
      const signData = await signResp.json();
      if (!signData.success) throw new Error(signData.error || 'İmzalama işlemi başarısız.');
      lastSignature = signData.signature;
      lastSignerName = signData.signerName || 'E-İmza Sahibi';
      lastCertDetails = signData.certDetails || null;
      updateSignedStatus(true);
      showToast('Doküman başarıyla imzalandı!', 'success');
      if (typeof window.udfManagerOnSigned === 'function') {
        await window.udfManagerOnSigned(lastSignature, lastSignerName, xmlContent);
      } else {
        downloadUdf(true, xmlContent);
      }
    } catch (err) {
      console.error('[LocalBridge]', err);
      if (err.name === 'TimeoutError' || err.message.includes('fetch')) {
        showToast('İmzalama servisi çalışmıyor. Terminal\'de: python signature_bridge.py', 'error');
      } else {
        showToast(err.message, 'error');
      }
    }
  });



  // ===================================================

  // Edit menu
  $('#actionUndo').addEventListener('click', () => { closeAllDropdowns(); document.execCommand('undo'); });
  $('#actionRedo').addEventListener('click', () => { closeAllDropdowns(); document.execCommand('redo'); });
  $('#actionSelectAll').addEventListener('click', () => { closeAllDropdowns(); document.execCommand('selectAll'); });
  $('#actionFind').addEventListener('click', () => {
    closeAllDropdowns();
    const panel = document.getElementById('findReplacePanel');
    if (panel) {
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) panel.querySelector('input').focus();
    }
  });

  // Insert menu
  const openFileHandler = () => { closeAllDropdowns(); $('#actionOpen').click(); };
  $('#btnOpenEkle')?.addEventListener('click', openFileHandler);

  const insertTableHandler = () => { closeAllDropdowns(); openTableDialog(); };
  $('#actionInsertTable').addEventListener('click', insertTableHandler);
  $('#btnInsertTableToolbar')?.addEventListener('click', insertTableHandler);

  const insertImageHandler = () => { closeAllDropdowns(); imageInput.click(); };
  $('#actionInsertImage').addEventListener('click', insertImageHandler);
  $('#btnInsertImageToolbar')?.addEventListener('click', insertImageHandler);

  imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.execCommand('insertImage', false, ev.target.result);
      showToast('Resim eklendi', 'success');
    };
    reader.readAsDataURL(file);
    imageInput.value = '';
  });

  const insertLinkHandler = () => { closeAllDropdowns(); openLinkDialog(); };
  $('#actionInsertLink').addEventListener('click', insertLinkHandler);
  $('#btnInsertLinkToolbar')?.addEventListener('click', insertLinkHandler);
  $('#btnInsertLinkEkle')?.addEventListener('click', insertLinkHandler);

  $('#actionInsertHR').addEventListener('click', () => { closeAllDropdowns(); document.execCommand('insertHorizontalRule'); });
  $('#actionInsertPageBreak').addEventListener('click', () => {
    closeAllDropdowns();
    document.execCommand('insertHTML', false, '<hr class="page-break">');
  });

  $('#btnAddHeader').addEventListener('click', () => {
    closeAllDropdowns();
    PaginationManager.setHeaderVisible(true);
    const firstHeader = PaginationManager.getHeaderArea();
    if (firstHeader) {
      firstHeader.focus();
      firstHeader.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (window.udfManagerUpdateHeaderFooter) window.udfManagerUpdateHeaderFooter(true, null);
  });

  $('#btnRemoveHeader').addEventListener('click', () => {
    closeAllDropdowns();
    if (confirm('Üst bilgi silinecek. Devam edilsin mi?')) {
      PaginationManager.setHeaderVisible(false);
      if (window.udfManagerUpdateHeaderFooter) window.udfManagerUpdateHeaderFooter(false, null);
    }
  });

  $('#btnAddFooter').addEventListener('click', () => {
    closeAllDropdowns();
    PaginationManager.setFooterVisible(true);
    const firstFooter = PaginationManager.getFooterArea();
    if (firstFooter) {
      firstFooter.focus();
      firstFooter.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (window.udfManagerUpdateHeaderFooter) window.udfManagerUpdateHeaderFooter(null, true);
  });

  $('#btnRemoveFooter').addEventListener('click', () => {
    closeAllDropdowns();
    if (confirm('Alt bilgi silinecek. Devam edilsin mi?')) {
      PaginationManager.setFooterVisible(false);
      if (window.udfManagerUpdateHeaderFooter) window.udfManagerUpdateHeaderFooter(null, false);
    }
  });

  $('#btnAddParagraph')?.addEventListener('click', () => {
    document.execCommand('insertParagraph');
  });

  // Sayfa Numarası (Ekle Paneli)
  $('#btnPageNumber')?.addEventListener('click', () => {
    showToast('Sayfa numarası otomatik olarak eklenmektedir.', 'info');
  });
  $('#btnPageBreak')?.addEventListener('click', () => {
    document.execCommand('insertHTML', false, '<hr class="page-break">');
  });
  $('#btnGoToPage')?.addEventListener('click', () => {
    const p = prompt('Gitmek istediğiniz sayfa numarası:');
    if(p) showToast('Sayfa ' + p + ' bulunamadı.', 'warning');
  });

  // Grafik - Diğer (Ekle Paneli)
  $('#btnBackgroundImg')?.addEventListener('click', () => showToast('Arka plan resmi özelliği yakında eklenecek.', 'info'));
  $('#btnInsertSymbol')?.addEventListener('click', () => showToast('Sembol ekleme paneli yakında eklenecek.', 'info'));
  $('#btnInsertBarcode')?.addEventListener('click', () => {
    const code = prompt('Barkod içeriği:');
    if(code) document.execCommand('insertHTML', false, `<div style="border:1px solid #000; padding:5px; display:inline-block; font-family:monospace;">BARCODE: ${code}</div>`);
  });

  // Format menu
  $('#actionClearFormat').addEventListener('click', () => { closeAllDropdowns(); document.execCommand('removeFormat'); });
  $('#actionSubscript').addEventListener('click', () => { closeAllDropdowns(); document.execCommand('subscript'); });
  $('#actionSuperscript').addEventListener('click', () => { closeAllDropdowns(); document.execCommand('superscript'); });

  // View menu
  $('#actionToggleRuler').addEventListener('click', () => { closeAllDropdowns(); $('#ruler').classList.toggle('hidden'); });
  $('#actionToggleStatusbar').addEventListener('click', () => { closeAllDropdowns(); $('#statusbar').classList.toggle('hidden'); });
  $('#actionZoomIn').addEventListener('click', () => { closeAllDropdowns(); setZoom(currentZoom + 10); });
  $('#actionZoomOut').addEventListener('click', () => { closeAllDropdowns(); setZoom(currentZoom - 10); });
  $('#actionZoomReset').addEventListener('click', () => { closeAllDropdowns(); setZoom(100); });

  function setZoom(val) {
    currentZoom = Math.max(50, Math.min(200, val));
    document.getElementById('pageContainer').style.transform = `scale(${currentZoom / 100})`;
    document.getElementById('pageContainer').style.transformOrigin = 'top center';
    $('#zoomLevelEl').textContent = currentZoom + '%';
  }

  // ===== Theme System (Light, Dark, Sepia/Warm) =====
  let currentTheme = 'light';

  function setTheme(themeName) {
    currentTheme = themeName;
    document.documentElement.setAttribute('data-theme', themeName);
    if (themeName === 'dark') {
      document.documentElement.classList.add('dark-mode');
      document.body.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
      document.body.classList.remove('dark-mode');
    }
    // Update theme toggle button icon
    const btn = document.getElementById('btnThemeToggle');
    if (btn) {
      const icon = btn.querySelector('.material-icons-outlined');
      if (icon) {
        if (themeName === 'dark')       icon.textContent = 'nights_stay';
        else if (themeName === 'sepia') icon.textContent = 'wb_incandescent';
        else                            icon.textContent = 'light_mode';
      }
    }
    // Update theme dropdown active state
    document.querySelectorAll('.theme-option-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === themeName);
    });
    localStorage.setItem('uyap_theme', themeName);
  }
  window.setThemePublic = setTheme;

  function initThemeSystem() {
    const btn = document.getElementById('btnThemeToggle');
    const dropdown = document.getElementById('themeDropdown');
    if (!btn || !dropdown) return;

    // Toggle dropdown on button click
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) dropdown.classList.add('open');
    });

    // Each theme option button
    dropdown.querySelectorAll('.theme-option-btn').forEach(optBtn => {
      optBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setTheme(optBtn.dataset.theme);
        dropdown.classList.remove('open');
      });
    });
  }

  // Proxy buttons in Ribbon
  const btnSign2 = document.getElementById('actionSignUDF2');
  if (btnSign2) {
      btnSign2.addEventListener('click', () => {
          const target = document.getElementById('actionSignUDF');
          if (target) target.click();
      });
  }

  const btnFullscreen2 = document.getElementById('actionFullscreen2');
  if (btnFullscreen2) {
      btnFullscreen2.addEventListener('click', () => {
          const target = document.getElementById('btnFullscreen');
          if (target) target.click();
      });
  }

  // ===== Fullscreen =====
  const btnFs = $('#btnFullscreen');
  if (btnFs) {
    btnFs.addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen();
      else document.exitFullscreen();
    });
  }

  // ===== Table Dialog =====
  const tableDialog = $('#tableDialog');
  const tableRows = $('#tableRows');
  const tableCols = $('#tableCols');
  const tablePreview = $('#tablePreview');

  function openTableDialog() {
    tableDialog.classList.remove('hidden');
    updateTablePreview();
    tableRows.focus();
  }

  function updateTablePreview() {
    const r = parseInt(tableRows.value) || 3;
    const c = parseInt(tableCols.value) || 3;
    tablePreview.style.gridTemplateColumns = `repeat(${Math.min(c, 10)}, 1fr)`;
    tablePreview.innerHTML = '';
    for (let i = 0; i < Math.min(r * c, 100); i++) {
      const cell = document.createElement('div');
      cell.className = 'table-preview-cell';
      tablePreview.appendChild(cell);
    }
  }

  tableRows.addEventListener('input', updateTablePreview);
  tableCols.addEventListener('input', updateTablePreview);

  $('#tableDialogInsert').addEventListener('click', () => {
    const r = parseInt(tableRows.value) || 3;
    const c = parseInt(tableCols.value) || 3;
    let html = '<table><thead><tr>';
    for (let j = 0; j < c; j++) html += '<th>Başlık ' + (j + 1) + '</th>';
    html += '</tr></thead><tbody>';
    for (let i = 0; i < r - 1; i++) {
      html += '<tr>';
      for (let j = 0; j < c; j++) html += '<td>&nbsp;</td>';
      html += '</tr>';
    }
    html += '</tbody></table><p>&nbsp;</p>';
    PaginationManager.getActivePage().querySelector('.editor').focus();
    document.execCommand('insertHTML', false, html);
    tableDialog.classList.add('hidden');
    showToast('Tablo eklendi', 'success');
  });

  $('#tableDialogCancel').addEventListener('click', () => tableDialog.classList.add('hidden'));
  $('#tableDialogClose').addEventListener('click', () => tableDialog.classList.add('hidden'));

  // ===== Link Dialog =====
  const linkDialog = $('#linkDialog');

  function openLinkDialog() {
    linkDialog.classList.remove('hidden');
    const sel = window.getSelection();
    if (sel.rangeCount && sel.toString()) {
      $('#linkText').value = sel.toString();
    } else {
      $('#linkText').value = '';
    }
    $('#linkUrl').value = '';
    $('#linkUrl').focus();
  }

  $('#linkDialogInsert').addEventListener('click', () => {
    const text = $('#linkText').value || 'Bağlantı';
    const url = $('#linkUrl').value;
    if (!url) { showToast('URL gerekli', 'error'); return; }
    PaginationManager.getActivePage().querySelector('.editor').focus();
    document.execCommand('insertHTML', false, `<a href="${url}" target="_blank">${text}</a>`);
    linkDialog.classList.add('hidden');
    showToast('Bağlantı eklendi', 'success');
  });

  $('#linkDialogCancel').addEventListener('click', () => linkDialog.classList.add('hidden'));
  $('#linkDialogClose').addEventListener('click', () => linkDialog.classList.add('hidden'));

  // Certificate Dialog Logic
  window.showCertDialog = function() {
      console.log('[showCertDialog] çağrıldı | lastSignature:', !!lastSignature, '| lastCertDetails:', lastCertDetails, '| lastSignerName:', lastSignerName);
      
      const dlg = document.getElementById('certDialog');
      if (!dlg) { console.error('[showCertDialog] certDialog elementi bulunamadı!'); return; }

      // İmza yoksa toast göster ve çık
      if (!lastSignature) {
          window.showToast('İmzalı bir UDF dosyası açın.', 'info');
          return;
      }

      // certDetails null olsa bile dialog aç — mevcut bilgiyle göster
      const cd = lastCertDetails || {};

      const subjectEl = document.getElementById('certSubject');
      const issuerEl  = document.getElementById('certIssuer');
      const serialEl  = document.getElementById('certSerial');
      const idNoEl    = document.getElementById('certIdentityNo');
      const fromEl    = document.getElementById('certValidFrom');
      const toEl      = document.getElementById('certValidTo');

      if (subjectEl) subjectEl.textContent = cd.subject || lastSignerName || 'Bilgi alınamadı';
      if (issuerEl)  issuerEl.textContent  = cd.issuer  || 'E-İmza Hizmet Sağlayıcısı';
      if (serialEl)  serialEl.textContent  = cd.serial  || 'Bilgi alınamadı (Bridge kapalı)';
      
      let idNo = cd.identityNo || '';
      if (idNo && idNo.length === 11 && !idNo.includes('*')) {
          idNo = idNo.substring(0, 2) + "*******" + idNo.substring(9);
      }
      if (idNoEl) idNoEl.textContent = idNo || 'Belirtilmedi';
      
      const formatDT = (isoStr) => {
          if (!isoStr) return 'Bilinmiyor';
          const d = new Date(isoStr);
          if (isNaN(d.getTime())) return isoStr;
          return d.toLocaleString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      };
      
      if (fromEl) fromEl.textContent = formatDT(cd.validFrom);
      if (toEl)   toEl.textContent   = formatDT(cd.validTo);
      
      dlg.classList.remove('hidden');
      console.log('[showCertDialog] dialog açıldı, hidden kaldırıldı');
  };
  
  // certDialog kapatma fonksiyonu (tüm listener'lardan önce tanımlanmalı)
  const closeCertDialog = () => {
      const dlg = document.getElementById('certDialog');
      if (dlg) {
          const modal = dlg.querySelector('.modal');
          if (modal) modal.classList.remove('visible');
          setTimeout(() => dlg.classList.add('hidden'), 200);
      }
  };

  // Event Delegation for dynamically moved/recreated signature UI elements
  document.body.addEventListener('click', (e) => {
      const isBadge = e.target.closest('#signedBadge');
      const isStamp = e.target.closest('#visualSignatureStamp');
      console.log('[body click] isBadge:', !!isBadge, '| isStamp:', !!isStamp, '| target:', e.target.id || e.target.className);
      if (isBadge || isStamp) {
          window.showCertDialog();
      }
  });

  // Keyboard accessibility: Enter/Space on signed badge + ESC to close dialog
  document.body.addEventListener('keydown', (e) => {
      const isBadge = e.target.closest && e.target.closest('#signedBadge');
      const isStamp = e.target.closest && e.target.closest('#visualSignatureStamp');
      if ((isBadge || isStamp) && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          window.showCertDialog();
      }
      if (e.key === 'Escape') {
          const dlg = document.getElementById('certDialog');
          if (dlg && !dlg.classList.contains('hidden')) {
              closeCertDialog();
          }
      }
  });

  // ===== Araçlar Ribbon: İmzalar ve Sertifikalar butonları =====
  const btnShowSignatures = document.getElementById('actionShowSignatures');
  if (btnShowSignatures) {
    btnShowSignatures.addEventListener('click', () => {
      if (!lastSignature) {
        showToast('Bu dokümanda henüz e-imza bulunmuyor. İmzalı bir UDF dosyası açın.', 'info');
        return;
      }
      if (lastCertDetails) {
        window.showCertDialog();
      } else {
        showToast('İmzalayan: ' + (lastSignerName || 'Bilinmiyor'), 'info');
      }
    });
  }

  const btnShowCerts = document.getElementById('actionShowCerts');
  if (btnShowCerts) {
    btnShowCerts.addEventListener('click', () => {
      if (!lastCertDetails) {
        showToast('Sertifika detayı yok. Önce imzalı bir UDF dosyası açın.', 'info');
        return;
      }
      window.showCertDialog();
    });
  }

  $('#certDialogClose')?.addEventListener('click', closeCertDialog);
  $('#certDialogCloseBtn')?.addEventListener('click', closeCertDialog);

  // certDialog overlay'e tıklayınca kapat
  const certDialogEl = document.getElementById('certDialog');
  if (certDialogEl) {
    certDialogEl.addEventListener('click', (e) => {
      if (e.target === certDialogEl) closeCertDialog();
    });
  }

  [tableDialog, linkDialog].forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });



  // ===== Find & Replace =====
  let searchMatches = [];
  let currentMatchIndex = -1;

  function clearFindHighlight() {
    $$('.editor').forEach(ed => {
      ed.querySelectorAll('mark[data-fr]').forEach(m => {
        const text = m.textContent;
        m.replaceWith(document.createTextNode(text));
      });
    });
  }

  function doSearch() {
    clearFindHighlight();
    searchMatches = [];
    currentMatchIndex = -1;
    const query = findInput.value;
    if (!query) { findCountEl.textContent = '0 sonuç'; return; }

    const activePage = PaginationManager.getActivePage();
    const activeEditor = activePage ? activePage.querySelector('.editor') : null;
    if (!activeEditor) { findCountEl.textContent = '0 sonuç'; return; }

    const treeWalker = document.createTreeWalker(activeEditor, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (treeWalker.nextNode()) textNodes.push(treeWalker.currentNode);

    const lowerQuery = query.toLowerCase();
    textNodes.forEach(node => {
      const text = node.textContent;
      const lowerText = text.toLowerCase();
      let idx = lowerText.indexOf(lowerQuery);
      if (idx === -1) return;
      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      while (idx !== -1) {
        frag.appendChild(document.createTextNode(text.substring(lastIdx, idx)));
        const mark = document.createElement('mark');
        mark.setAttribute('data-fr', 'true');
        mark.style.background = '#fde68a';
        mark.style.borderRadius = '2px';
        mark.textContent = text.substring(idx, idx + query.length);
        frag.appendChild(mark);
        searchMatches.push(mark);
        lastIdx = idx + query.length;
        idx = lowerText.indexOf(lowerQuery, lastIdx);
      }
      frag.appendChild(document.createTextNode(text.substring(lastIdx)));
      node.parentNode.replaceChild(frag, node);
    });

    findCountEl.textContent = searchMatches.length + ' sonuç';
    if (searchMatches.length > 0) goToMatch(0);
  }

  function goToMatch(idx) {
    if (searchMatches.length === 0) return;
    if (currentMatchIndex >= 0 && searchMatches[currentMatchIndex]) {
      searchMatches[currentMatchIndex].style.background = '#fde68a';
    }
    currentMatchIndex = ((idx % searchMatches.length) + searchMatches.length) % searchMatches.length;
    const match = searchMatches[currentMatchIndex];
    if (match) {
      match.style.background = '#f97316';
      match.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    findCountEl.textContent = (currentMatchIndex + 1) + '/' + searchMatches.length;
  }

  findInput.addEventListener('input', doSearch);
  $('#findNext').addEventListener('click', () => goToMatch(currentMatchIndex + 1));
  $('#findPrev').addEventListener('click', () => goToMatch(currentMatchIndex - 1));

  $('#replaceOne').addEventListener('click', () => {
    if (currentMatchIndex < 0 || !searchMatches[currentMatchIndex]) return;
    const match = searchMatches[currentMatchIndex];
    match.replaceWith(document.createTextNode(replaceInput.value));
    searchMatches.splice(currentMatchIndex, 1);
    if (searchMatches.length > 0) goToMatch(currentMatchIndex);
    else { findCountEl.textContent = '0 sonuç'; currentMatchIndex = -1; }
    markDirty();
  });

  $('#replaceAll').addEventListener('click', () => {
    searchMatches.forEach(m => m.replaceWith(document.createTextNode(replaceInput.value)));
    searchMatches = [];
    currentMatchIndex = -1;
    findCountEl.textContent = '0 sonuç';
    markDirty();
    showToast('Tümü değiştirildi', 'success');
  });

  $('#frClose').addEventListener('click', () => {
    clearHighlights();
    findReplacePanel.classList.add('hidden');
  });

  // ===== Keyboard Shortcuts =====
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 's':
          e.preventDefault();
          if (window.triggerGlobalSavePublic) window.triggerGlobalSavePublic();
          else $('#actionSaveHTML').click();
          break;
        case 'o':
          e.preventDefault();
          $('#actionOpen').click();
          break;
        case 'h': e.preventDefault(); $('#actionFind').click(); break;
        case 'p': e.preventDefault(); window.print(); break;
        case '=': case '+': e.preventDefault(); setZoom(currentZoom + 10); break;
        case '-': e.preventDefault(); setZoom(currentZoom - 10); break;
        case '0': e.preventDefault(); setZoom(100); break;
      }
    }
    if (e.key === 'Escape') {
      closeAllDropdowns();
      findReplacePanel.classList.add('hidden');
      tableDialog.classList.add('hidden');
      linkDialog.classList.add('hidden');
    }
  });

  // ===== Toast Notifications (Moved to Top) =====
  // Deprecated global name, keeping for compatibility
  window.showToastPublic = window.showToast;

  // ===== Ruler =====
  function buildRuler() {
    const track = $('#rulerTrack');
    track.innerHTML = '';
    for (let i = 0; i <= 21; i++) {
      const mark = document.createElement('div');
      mark.style.cssText = `position:absolute;left:${i * (100/21)}%;bottom:0;font-size:8px;color:var(--text-muted);transform:translateX(-50%);`;
      mark.textContent = i;
      track.appendChild(mark);
    }
  }

  // ===== Drag & Drop =====
  editorWrapper.addEventListener('dragover', (e) => { e.preventDefault(); editorWrapper.style.outline = '2px dashed var(--accent)'; });
  editorWrapper.addEventListener('dragleave', () => { editorWrapper.style.outline = 'none'; });
  editorWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    editorWrapper.style.outline = 'none';
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      const activePage = PaginationManager.getActivePage();
      const activeEditor = activePage ? activePage.querySelector('.editor') : null;
      if (!activeEditor) return;

      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          activeEditor.focus();
          document.execCommand('insertImage', false, ev.target.result);
        };
        reader.readAsDataURL(file);
      } else if (file.type === 'text/html' || file.type === 'text/plain') {
        const reader = new FileReader();
        reader.onload = (ev) => { 
          activeEditor.focus();
          document.execCommand('insertHTML', false, ev.target.result);
          markDirty(); 
        };
        reader.readAsText(file);
      }
    }
  });

  // ===== Paste cleanup =====
  editorWrapper.addEventListener('paste', () => { markDirty(); });

  // ===== Initialize =====
  function init() {
    buildRuler();
    loadFromLocalStorage();
    updateCounts();
    updateToolbarState();
    initThemeSystem();
    
    const savedTheme = localStorage.getItem('uyap_theme');
    if (savedTheme) {
      setTheme(savedTheme);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
    } else {
      setTheme('light');
    }

    // Bridge durumu kontrol et (hata vermesin, sessizce çalışsın)
    checkBridgeStatus().catch(() => {});
    // Her 30 saniyede bir kontrol et
    setInterval(() => checkBridgeStatus().catch(() => {}), 30000);

    const ap = PaginationManager.getActivePage();
    if (ap) ap.querySelector('.editor').focus();
  }

  init();
  // Ensure we focus the editor after init
  setTimeout(() => {
    const ap = PaginationManager.getActivePage();
    if (ap) ap.querySelector('.editor').focus();
  }, 100);
})();

// Yeni Eklenen Butonların Olay Dinleyicileri
const addMissingButtonListener = (id, message) => {
    const btn = document.getElementById(id);
    if (btn) {
        btn.addEventListener('click', () => {
            if (typeof window.showToast === 'function') {
                window.showToast(message, 'info');
            } else if (typeof window.showToastPublic === 'function') {
                window.showToastPublic(message, 'info');
            } else {
                alert(message);
            }
        });
    }
};

addMissingButtonListener('actionOpenBackup', 'Yedekleri açma arayüzü henüz uygulanmadı.');
addMissingButtonListener('actionSaveAllAs', 'Tümünü farklı kaydet özelliği henüz uygulanmadı.');
addMissingButtonListener('actionSaveODT', 'ODT olarak kaydetme özelliği henüz uygulanmadı.');
addMissingButtonListener('actionPrintPreview', 'Yazdırma önizlemesi için sistem yazdırma menüsü kullanılabilir (Ctrl+P).');
addMissingButtonListener('actionBatchPrint', 'Toplu yazdırma işlemi henüz uygulanmadı.');
addMissingButtonListener('actionBatchSign', 'Toplu imzalama arayüzü henüz uygulanmadı.');
addMissingButtonListener('actionExport', 'Dışa aktarma seçenekleri henüz uygulanmadı.');
addMissingButtonListener('actionSend', 'Gönderme seçenekleri henüz uygulanmadı.');
addMissingButtonListener('actionListWindows', 'Açık pencereleri listeleme özelliği henüz uygulanmadı.');

const btnExitApp = document.getElementById('actionExitApp');
if (btnExitApp) {
    btnExitApp.addEventListener('click', () => {
        if (confirm('Uygulamadan çıkmak istediğinize emin misiniz? Kaydedilmemiş değişiklikler kaybolabilir.')) {
            window.close();
            if(typeof showToast === 'function') showToast('Tarayıcı penceresi kapatılıyor...', 'info');
        }
    });
}

// ===== GET Parametreleri (Şablon) İşleme =====
const initTemplateFromUrl = () => {
  // udfManager tam yüklenmesi için küçük bir gecikme
  setTimeout(() => {
    const params = new URLSearchParams(window.location.search);
    const templateName = params.get('template');
    
    if (templateName && typeof window.udfManagerLoadFromUrl === 'function') {
      const templateUrl = '/templates/' + templateName + (templateName.endsWith('.udf') ? '' : '.udf');
      
      const paramsObj = {};
      for (const [k, v] of params.entries()) {
        if (k !== 'template') paramsObj[k] = v;
      }
      
      window.udfManagerLoadFromUrl(templateUrl, paramsObj);
    }
  }, 300);
};

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initTemplateFromUrl);
} else {
  initTemplateFromUrl();
}

