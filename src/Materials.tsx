import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { api, errMsg, fmtSize, MAX_FILE_BYTES, uploadFileInParts, type Material, type Stream } from './lib';
import { Alert, Btn, Card, inputCls, labelCls, Spinner, StreamPicker } from './ui';
import MaterialCard from './MaterialCard';

type Props = {
  myStreams: Stream[];
  allStreams: Stream[];
  defaultSubject: string;
};

export default function Materials({ myStreams, allStreams, defaultSubject }: Props) {
  const [items, setItems] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState('');
  const [editingId, setEditingId] = useState('');
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [selected, setSelected] = useState<string[]>(myStreams.length === 1 ? [myStreams[0].id] : []);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [removeFile, setRemoveFile] = useState(false);
  const [uploadPct, setUploadPct] = useState(-1);
  const [formErr, setFormErr] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');

  const streamNames: Record<string, string> = {};
  allStreams.forEach((s) => {
    streamNames[s.id] = s.name;
  });
  const editing = items.find((m) => m.id === editingId) || null;

  const load = useCallback(async () => {
    setLoading(true);
    setListErr('');
    try {
      const r = await api.get('/api/teacher/materials');
      setItems((r.data?.materials || []) as Material[]);
    } catch (e) {
      setListErr(errMsg(e, 'Could not load your materials.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setEditingId('');
    setTitle('');
    setSubject(defaultSubject);
    setBody('');
    setLink('');
    setSelected(myStreams.length === 1 ? [myStreams[0].id] : []);
    setFile(null);
    setFileKey((k) => k + 1);
    setRemoveFile(false);
    setFormErr('');
  }

  function startEdit(m: Material) {
    setEditingId(m.id);
    setTitle(m.title);
    setSubject(m.subject);
    setBody(m.body || '');
    setLink(m.link || '');
    setSelected(m.streamIds.filter((id) => myStreams.some((s) => s.id === id)));
    setFile(null);
    setFileKey((k) => k + 1);
    setRemoveFile(false);
    setFormErr('');
    setNotice('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormErr('');
    setNotice('');
    if (!title.trim()) {
      setFormErr('Give the material a title.');
      return;
    }
    if (!subject.trim()) {
      setFormErr('Enter the subject.');
      return;
    }
    if (!selected.length) {
      setFormErr('Choose at least one class / stream.');
      return;
    }
    const keepsFile = !!editing && !!editing.attachment && !removeFile;
    if (!body.trim() && !link.trim() && !file && !keepsFile) {
      setFormErr('Add notes, a link or a file for your students.');
      return;
    }
    if (file && file.size > MAX_FILE_BYTES) {
      setFormErr(`This file is ${fmtSize(file.size)}. Attachments must be 20 MB or smaller.`);
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { title, subject, body, link, streamIds: selected, removeFile };
      if (file) {
        payload.file = {
          contentType: file.type || 'application/octet-stream',
          ...(await uploadFileInParts(file, 'teacher', '', setUploadPct)),
        };
      }
      if (editingId) {
        await api.put(`/api/teacher/materials/${editingId}`, payload);
        setNotice('Changes saved. Students now see the updated material.');
      } else {
        await api.post('/api/teacher/materials', payload);
        setNotice('Material posted. Students in the selected classes can now see it.');
      }
      resetForm();
      await load();
    } catch (ex) {
      setFormErr(errMsg(ex, 'Could not save the material. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(m: Material) {
    if (!window.confirm(`Delete “${m.title}”? Students will no longer see it.`)) return;
    setDeletingId(m.id);
    try {
      await api.delete(`/api/teacher/materials/${m.id}`);
      setItems((prev) => prev.filter((x) => x.id !== m.id));
      if (editingId === m.id) resetForm();
    } catch (e) {
      setListErr(errMsg(e, 'Could not delete the material.'));
    } finally {
      setDeletingId('');
    }
  }

  const savingLabel = uploadPct >= 0 ? `Uploading file ${uploadPct}%…` : 'Saving…';

  return (
    <div className='grid gap-6 lg:grid-cols-5'>
      <div className='lg:col-span-2'>
        <Card>
          <div className='flex items-center justify-between gap-2'>
            <h2 className='text-lg font-bold text-slate-900'>
              {editing ? 'Edit learning material' : 'Post learning material'}
            </h2>
            {editing && (
              <Btn variant='ghost' onClick={resetForm}>
                <X className='h-4 w-4' />
                Cancel edit
              </Btn>
            )}
          </div>
          {myStreams.length === 0 ? (
            <div className='mt-3'>
              <Alert kind='info'>
                You have not been assigned any class yet. Ask the principal to assign your classes, then post materials
                here.
              </Alert>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className='mt-4 space-y-4'>
              <div>
                <label htmlFor='m-title' className={labelCls}>
                  Title
                </label>
                <input
                  id='m-title'
                  className={inputCls}
                  value={title}
                  placeholder='e.g. Week 1 revision: Algebra'
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor='m-subject' className={labelCls}>
                  Subject
                </label>
                <input id='m-subject' className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div>
                <span className={labelCls}>Classes / streams</span>
                <StreamPicker streams={myStreams} value={selected} onChange={setSelected} />
              </div>
              <div>
                <label htmlFor='m-body' className={labelCls}>
                  Notes and instructions
                </label>
                <textarea
                  id='m-body'
                  rows={6}
                  className={inputCls}
                  value={body}
                  placeholder='Write the lesson notes, questions or instructions here'
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor='m-link' className={labelCls}>
                  Link (optional)
                </label>
                <input
                  id='m-link'
                  className={inputCls}
                  value={link}
                  placeholder='https://'
                  onChange={(e) => setLink(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor='m-file' className={labelCls}>
                  {editing && editing.attachment ? 'Replace the attachment (optional)' : 'Attachment (optional)'}
                </label>
                {editing && editing.attachment && !file && (
                  <div className='mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-700'>
                    {removeFile ? (
                      <>
                        <span className='text-red-700'>The current file will be removed.</span>
                        <button
                          type='button'
                          className='font-semibold text-emerald-700 hover:underline'
                          onClick={() => setRemoveFile(false)}
                        >
                          Keep it
                        </button>
                      </>
                    ) : (
                      <>
                        <span>
                          Current file: <span className='font-semibold'>{editing.attachment.name}</span>
                        </span>
                        <button
                          type='button'
                          className='font-semibold text-red-700 hover:underline'
                          onClick={() => setRemoveFile(true)}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                )}
                <input
                  key={fileKey}
                  id='m-file'
                  type='file'
                  accept='.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,image/*'
                  className='block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-emerald-800'
                  onChange={(e) => setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                />
                <p className='mt-1 text-xs text-slate-500'>PDF, Word, PowerPoint, Excel or images, up to 20 MB.</p>
              </div>
              {formErr && <Alert>{formErr}</Alert>}
              {notice && <Alert kind='success'>{notice}</Alert>}
              <Btn type='submit' disabled={saving} className='w-full'>
                {saving ? savingLabel : editing ? 'Save changes' : 'Post material'}
              </Btn>
            </form>
          )}
        </Card>
      </div>
      <div className='space-y-4 lg:col-span-3'>
        <h2 className='text-lg font-bold text-slate-900'>Posted materials ({items.length})</h2>
        {listErr && <Alert>{listErr}</Alert>}
        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <Card className='text-sm text-slate-500'>Nothing posted yet. Materials you post will appear here.</Card>
        ) : (
          items.map((m) => (
            <MaterialCard
              key={m.id}
              m={m}
              streamNames={streamNames}
              onEdit={() => startEdit(m)}
              onDelete={() => remove(m)}
              deleting={deletingId === m.id}
            />
          ))
        )}
      </div>
    </div>
  );
}

