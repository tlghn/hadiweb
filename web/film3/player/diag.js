// HADİ Film v3 — ses tanı katmanı (yalnızca kurucu/geliştirici; player.js ?f3debug=1 ya da {type:'debug', on:true} ile
// yükler, normal üyede hiç yüklenmez). Telefonda "konuşma neden duyulmuyor" sorusunu yerinde yanıtlamak için: ses bağlamı,
// örnekleme hızı, parçaların durumu (indirme/çözme/akış), ses filtresi kipi, konuşma ve arka plan düzeyi, son hatalar.
// Parça durumu: B çözüldü · P indiriliyor/çözülüyor · A akıştan (hazır) · a akış dolmadı · 0 başarısız (yeniden denenecek)
// · X çalınamıyor · - pencere dışında.

const db = (x) => (x > 1e-6 ? 20 * Math.log10(x) : -120);

export function startDiag(player) {
  if (window.__f3diag) return window.__f3diag;
  const el = document.createElement('div');
  el.id = 'f3diag';
  Object.assign(el.style, {
    position: 'absolute', left: '6px', top: '6px', zIndex: 50, pointerEvents: 'none', maxWidth: 'min(96vw, 460px)',
    padding: '6px 8px', borderRadius: '8px', background: 'rgba(8,10,14,.78)', color: '#DDE6EE', whiteSpace: 'pre-wrap',
    font: '10.5px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', border: '1px solid rgba(255,255,255,.18)',
  });
  document.body.appendChild(el);
  const nav = navigator;
  let coarse = false;
  try { coarse = matchMedia('(pointer:coarse)').matches; } catch (_) {}
  const dev = `cihaz: çekirdek ${nav.hardwareConcurrency || '?'} · bellek ${nav.deviceMemory || '?'} GB · ${coarse ? 'dokunmatik' : 'fare'}`;
  let peak = -120;
  const bar = (v) => { const n = Math.max(0, Math.min(24, Math.round((v + 60) / 2.5))); return '█'.repeat(n) + '·'.repeat(24 - n); };
  const tick = () => {
    const A = player.audio;
    let d;
    try { d = A.diag(); } catch (e) { el.textContent = 'tanı hatası: ' + e.message; return; }
    const m = A.meters ? A.meters() : null;
    const sp = m ? db(m.speech) : -120, bg = m ? db(m.bg) : -120;
    peak = Math.max(sp, peak - 1.5);
    const fx = d.fx;
    const parts = d.parts.map((p) => `${p.i}:${p.st}${p.kb ? ' ' + p.kb + 'k' : ''}${p.fetchMs != null ? ' ↓' + (p.fetchMs / 1000).toFixed(1) + 's' : ''}${p.decMs != null ? ' ⚙' + (p.decMs / 1000).toFixed(1) + 's' : ''}${p.fail ? ' ✗' + p.fail : ''}`).join('  ');
    const lines = [
      `ses: ${d.state} · ${d.sr} Hz · gecikme ${d.base}/${d.out} ms · ${d.playing ? (d.waiting ? 'BEKLİYOR' : 'oynuyor') : 'durdu'} · t=${d.t}s`,
      `bölüm sesi: ${d.chapter ? 'var' : 'YOK'} · anlatıcı ${d.narration ? 'açık' : 'kapalı'} · çalan dilim ${d.src} (toplam ${d.started})`,
      `parçalar: ${parts || '-'}`,
      fx ? `filtre: ${fx.mode}${fx.want && fx.want !== fx.mode ? ' (istenen ' + fx.want + ')' : ''} · yük %${fx.load}${fx.on ? ' (açık)' : ''} · saat oranı ${fx.ratio ?? '-'}${fx.why ? ' · ' + fx.why : ''}${fx.nan ? ' · NaN ' + fx.nan : ''}` : 'filtre: -',
      `konuşma ${bar(sp)} ${sp.toFixed(0)} dB (tepe ${peak.toFixed(0)})`,
      `arka plan ${bar(bg)} ${bg.toFixed(0)} dB · fark ${(sp - bg).toFixed(0)} dB`,
      dev,
      ...d.errs.slice(-6).map((e) => `! ${(e.at / 1000).toFixed(1)}s ${e.kind}: ${e.msg}`.slice(0, 140)),
    ];
    el.textContent = lines.join('\n');
  };
  const iv = setInterval(tick, 250);
  tick();
  const api = { stop() { clearInterval(iv); el.remove(); window.__f3diag = null; } };
  window.__f3diag = api;
  return api;
}
