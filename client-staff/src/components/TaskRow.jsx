import { useRef, useState } from 'react';
import api, { fileUrl } from '../api/client.js';
import { useLang } from '../i18n.jsx';
import Spinner from './Spinner.jsx';

const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * One task. Owns its own save state so a slow request on one row never freezes
 * the rest of the list — the user keeps ticking while it settles.
 */
export default function TaskRow({ task, runId, onChange }) {
  const { t, lang, pick } = useLang();

  const [answer, setAnswer] = useState(task.answer);
  const [comment, setComment] = useState(task.comment || '');
  const [answeredAt, setAnsweredAt] = useState(task.answeredAt);
  const [revision, setRevision] = useState(task.revision || 0);
  const [photos, setPhotos] = useState(task.photos || []);

  const [editing, setEditing] = useState(false);   // comment box open
  const [draft, setDraft] = useState(task.comment || '');
  const [pendingNo, setPendingNo] = useState(false); // comment box opened by "No"
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(false);

  const fileRef = useRef(null);

  const save = async (value, commentText) => {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.put(`/runs/${runId}/answers/${task.id}`, {
        answer: value,
        comment: commentText?.trim() || null,
      });
      setAnswer(data.answer);
      setComment(data.comment || '');
      setAnsweredAt(data.answeredAt);
      setRevision(data.revision);
      setEditing(false);
      setPendingNo(false);
      setFlash(true);
      setTimeout(() => setFlash(false), 900);
      onChange?.({ taskId: task.id, answer: data.answer, previous: answer });
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setSaving(false);
    }
  };

  const onYes = () => {
    if (saving) return;
    save(true, comment);
  };

  // "No" never saves straight away — it opens the box and waits for a reason.
  const onNo = () => {
    if (saving) return;
    setDraft(comment);
    setPendingNo(true);
    setEditing(true);
  };

  const confirmNo = () => {
    if (!draft.trim()) return setError(t('commentRequired'));
    save(false, draft);
  };

  const saveComment = () => save(answer, draft);

  const clear = async () => {
    setSaving(true);
    try {
      await api.delete(`/runs/${runId}/answers/${task.id}`);
      const prev = answer;
      setAnswer(null);
      setComment('');
      setAnsweredAt(null);
      setPhotos([]);
      setEditing(false);
      onChange?.({ taskId: task.id, answer: null, previous: prev });
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('photo', file);
      const { data } = await api.post(`/runs/${runId}/answers/${task.id}/photos`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPhotos((p) => [...p, data]);
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async (id) => {
    try {
      await api.delete(`/runs/${runId}/photos/${id}`);
      setPhotos((p) => p.filter((x) => x.id !== id));
    } catch (err) {
      setError(err.userMessage);
    }
  };

  const answered = answer !== null && answer !== undefined;
  const rowClass = [
    'task',
    answered ? (answer ? 'ok' : 'fail') : '',
    flash ? 'flash' : '',
  ].join(' ').trim();

  return (
    <li className={rowClass}>
      <div className="task-main">
        <div className="task-text">
          <div className="task-title">
            {pick(task, 'title')}
            {task.isCritical && <span className="pill danger sm">{t('critical')}</span>}
            {task.frequency !== 'every_shift' && (
              <span className="pill muted sm">{t(task.frequency)}</span>
            )}
          </div>

          {pick(task, 'description') && (
            <div className="task-desc">{pick(task, 'description')}</div>
          )}

          {task.carriedOver && !answered && (
            <div className="carry-note">
              {t('doneEarlier')} — {task.carriedOver.answer ? t('yes') : t('no')} {t('doneBy')}{' '}
              {task.carriedOver.byName} {t('at')} {timeOf(task.carriedOver.answeredAt)}
            </div>
          )}
        </div>

        <div className="task-actions">
          <button
            type="button"
            className={`ans-btn yes ${answer === true ? 'active' : ''}`}
            onClick={onYes}
            disabled={saving}
            aria-pressed={answer === true}
          >
            ✓
          </button>
          <button
            type="button"
            className={`ans-btn no ${answer === false ? 'active' : ''}`}
            onClick={onNo}
            disabled={saving}
            aria-pressed={answer === false}
          >
            ✕
          </button>
        </div>
      </div>

      {answered && !editing && (
        <div className="task-meta">
          <span className="ts">
            {answer ? t('yes') : t('no')} · {timeOf(answeredAt)}
            {revision > 1 && ` · ${t('edited')}`}
          </span>

          <div className="meta-actions">
            <button className="link-btn" onClick={() => { setDraft(comment); setPendingNo(false); setEditing(true); }}>
              {comment ? `💬 ${t('comment')}` : `+ ${t('comment')}`}
            </button>
            <button className="link-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? t('uploading') : `📷 ${t('addPhoto')}`}
            </button>
            <button className="link-btn danger" onClick={clear} disabled={saving}>
              {t('clear')}
            </button>
          </div>
        </div>
      )}

      {answered && comment && !editing && <div className="task-comment">{comment}</div>}

      {editing && (
        <div className="comment-editor">
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(''); }}
            placeholder={pendingNo ? t('commentRequired') : t('addComment')}
            rows={3}
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
            autoFocus
          />
          <div className="editor-actions">
            <button
              className="btn ghost sm"
              onClick={() => { setEditing(false); setPendingNo(false); setError(''); }}
              disabled={saving}
            >
              {t('cancel')}
            </button>
            <button
              className={`btn sm ${pendingNo ? 'danger' : 'primary'}`}
              onClick={pendingNo ? confirmNo : saveComment}
              disabled={saving || (pendingNo && !draft.trim())}
            >
              {saving ? <Spinner small /> : pendingNo ? `${t('no')} · ${t('save')}` : t('save')}
            </button>
          </div>
        </div>
      )}

      {photos.length > 0 && (
        <div className="photo-strip">
          {photos.map((p) => (
            <div className="thumb" key={p.id}>
              <img src={fileUrl(p.url)} alt="" loading="lazy" />
              <button className="thumb-x" onClick={() => removePhoto(p.id)} aria-label="remove">
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="task-error">{error}</div>}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={uploadPhoto}
      />
    </li>
  );
}
