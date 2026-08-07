import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { downloadFile, fileUrl } from '../api/client.js';
import { useLang } from '../i18n.jsx';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';

const today = () => new Date().toISOString().slice(0, 10);

export default function Reports() {
  const { t, lang, pick } = useLang();

  const [users, setUsers] = useState([]);
  const [locations, setOutlets] = useState([]);
  const [shifts, setShifts] = useState([]);

  const [filters, setFilters] = useState({
    from: today(),
    to: today(),
    userId: '',
    locationId: '',
    shiftTypeId: '',
    answer: '',
  });

  const [result, setResult] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');
  // The row whose photos are open in the viewer, plus which one is showing.
  const [viewer, setViewer] = useState(null);

  useEffect(() => {
    Promise.all([api.get('/users'), api.get('/locations'), api.get('/shifts')])
      .then(([u, o, s]) => {
        setUsers(u.data);
        setOutlets(o.data);
        setShifts(s.data);
      })
      .catch((err) => setError(err.userMessage));
  }, []);

  // Strip empty strings so the API's optional filters stay optional.
  const params = useMemo(() => {
    const p = { from: filters.from, to: filters.to, lang };
    for (const k of ['userId', 'locationId', 'shiftTypeId', 'answer']) {
      if (filters[k] !== '') p[k] = filters[k];
    }
    return p;
  }, [filters, lang]);

  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rowsRes, sumRes] = await Promise.all([
        api.get('/reports/rows', { params }),
        api.get('/reports/summary', { params }),
      ]);
      setResult(rowsRes.data);
      setSummary(sumRes.data);
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    run();
    // Run once on mount with today's defaults; after that it's on the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportAs = async (kind) => {
    setExporting(kind);
    setError('');
    try {
      await downloadFile(
        `/reports/export.${kind}`,
        params,
        `checklist_${filters.from}_${filters.to}.${kind}`
      );
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setExporting('');
    }
  };

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="page-body">
      <div className="page-head">
        <h1>{t('reports')}</h1>
      </div>

      <section className="panel filter-panel">
        <div className="filter-grid">
          <label className="field">
            <span>{t('from')}</span>
            <input type="date" value={filters.from} onChange={set('from')} />
          </label>
          <label className="field">
            <span>{t('to')}</span>
            <input type="date" value={filters.to} onChange={set('to')} />
          </label>
          <label className="field">
            <span>{t('staff')}</span>
            <select value={filters.userId} onChange={set('userId')}>
              <option value="">{t('allStaff')}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('location')}</span>
            <select value={filters.locationId} onChange={set('locationId')}>
              <option value="">{t('allOutlets')}</option>
              {locations.map((o) => (
                <option key={o.id} value={o.id}>
                  {pick(o, 'name')}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('shift')}</span>
            <select value={filters.shiftTypeId} onChange={set('shiftTypeId')}>
              <option value="">{t('allShifts')}</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {pick(s, 'name')}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('answer')}</span>
            <select value={filters.answer} onChange={set('answer')}>
              <option value="">{t('all')}</option>
              <option value="yes">{t('yes')}</option>
              <option value="no">{t('onlyIssues')}</option>
            </select>
          </label>
        </div>

        <div className="filter-actions">
          <button className="btn primary" onClick={run} disabled={loading}>
            {loading ? <Spinner small /> : t('run')}
          </button>
          <button
            className="btn ghost"
            onClick={() => exportAs('xlsx')}
            disabled={!!exporting || !result?.count}
          >
            {exporting === 'xlsx' ? <Spinner small /> : `⬇ ${t('exportExcel')}`}
          </button>
          <button
            className="btn ghost"
            onClick={() => exportAs('pdf')}
            disabled={!!exporting || !result?.count}
          >
            {exporting === 'pdf' ? <Spinner small /> : `⬇ ${t('exportPdf')}`}
          </button>
          <span className="muted small">
            {result ? `${result.count} ${t('rows')}` : ''}
          </span>
        </div>
      </section>

      {error && <div className="alert error">{error}</div>}

      {summary && summary.totals.answers > 0 && (
        <div className="stat-row">
          <div className="stat">
            <div className="stat-value">{summary.totals.answers}</div>
            <div className="stat-label">{t('totalChecks')}</div>
          </div>
          <div className="stat">
            <div className="stat-value ok">{summary.totals.yes}</div>
            <div className="stat-label">{t('yes')}</div>
          </div>
          <div className={`stat ${summary.totals.no ? 'danger' : ''}`}>
            <div className="stat-value">{summary.totals.no}</div>
            <div className="stat-label">{t('no')}</div>
          </div>
          <div className={`stat ${summary.totals.critical ? 'danger' : ''}`}>
            <div className="stat-value">{summary.totals.critical}</div>
            <div className="stat-label">{t('criticalIssues')}</div>
          </div>
        </div>
      )}

      {summary && summary.byUser.length > 1 && (
        <section className="panel">
          <h3>{t('summary')}</h3>
          <div className="table-scroll">
            <table className="table compact">
              <thead>
                <tr>
                  <th>{t('staff')}</th>
                  <th>{t('totalChecks')}</th>
                  <th>{t('yes')}</th>
                  <th>{t('no')}</th>
                  <th>{t('critical')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.byUser.map((g) => (
                  <tr key={g.key}>
                    <td>{g.label}</td>
                    <td className="mono">{g.total}</td>
                    <td className="mono ok">{g.yes}</td>
                    <td className={`mono ${g.no ? 'text-danger' : ''}`}>{g.no}</td>
                    <td className={`mono ${g.critical ? 'text-danger' : ''}`}>{g.critical}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        {loading ? (
          <div className="center-block">
            <Spinner />
          </div>
        ) : !result || result.count === 0 ? (
          <p className="muted center-block">{t('noResults')}</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('date')}</th>
                  <th>{t('time')}</th>
                  <th>{t('shift')}</th>
                  <th>{t('staff')}</th>
                  <th>{t('location')}</th>
                  <th>{t('subLocation')}</th>
                  <th>{t('task')}</th>
                  <th>{t('answer')}</th>
                  <th>{t('comment')}</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.answerId} className={r.answer ? '' : 'row-fail'}>
                    <td className="mono nowrap">{r.businessDate}</td>
                    <td className="mono nowrap">{r.localTime.slice(11)}</td>
                    <td>{r.shiftCode}</td>
                    <td className="nowrap">
                      {r.fullName}
                      {r.runSource === 'unscheduled' && <span className="tag warn sm">!</span>}
                    </td>
                    <td>{r.location}</td>
                    <td>{r.subLocation}</td>
                    <td>
                      {r.task}
                      {r.isCritical && <span className="tag danger sm">{t('critical')}</span>}
                      {r.revision > 1 && <span className="tag sm">{t('edited')}</span>}
                    </td>
                    <td className={r.answer ? 'ok bold' : 'text-danger bold'}>
                      {r.answer ? t('yes') : t('no')}
                    </td>
                    <td className="comment-cell">
                      {r.comment}
                      {r.photos?.length > 0 && (
                        <div className="report-thumbs">
                          {r.photos.map((p, i) => (
                            <button
                              key={p.id}
                              type="button"
                              className="report-thumb"
                              onClick={() => setViewer({ row: r, index: i })}
                              title={t('viewPhoto')}
                            >
                              <img src={fileUrl(p.url)} alt="" loading="lazy" />
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {viewer && (
        <Modal
          wide
          title={`${viewer.row.location} · ${viewer.row.task}`}
          onClose={() => setViewer(null)}
        >
          <div className="photo-viewer">
            <img
              src={fileUrl(viewer.row.photos[viewer.index].url)}
              alt={viewer.row.task}
            />
            <div className="photo-viewer-meta">
              <span className="mono small">
                {viewer.row.localTime} · {viewer.row.fullName}
              </span>
              {viewer.row.photos.length > 1 && (
                <span className="muted small">
                  {viewer.index + 1} / {viewer.row.photos.length}
                </span>
              )}
            </div>

            {viewer.row.photos.length > 1 && (
              <div className="photo-viewer-strip">
                {viewer.row.photos.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`report-thumb ${i === viewer.index ? 'active' : ''}`}
                    onClick={() => setViewer((v) => ({ ...v, index: i }))}
                  >
                    <img src={fileUrl(p.url)} alt="" />
                  </button>
                ))}
              </div>
            )}

            <a
              className="btn ghost sm"
              href={fileUrl(viewer.row.photos[viewer.index].url)}
              target="_blank"
              rel="noreferrer"
            >
              {t('openFullSize')}
            </a>
          </div>
        </Modal>
      )}
    </div>
  );
}
