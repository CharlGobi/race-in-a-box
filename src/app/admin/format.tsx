import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import type { AdminError } from '@/admin/client';
import { FormatEditor } from '@/admin/format-editor';
import { deleteFormat, loadFormats, saveFormat } from '@/admin/formats';
import { blankTemplate, cloneTemplate, tidyTemplate, validateTemplate } from '@/core/template-builder';
import type { RaceTemplate } from '@/core/types';
import { Btn, C, H1, Notice, Screen } from '@/ui/kit';

// /admin/format?org=..&id=<saved format>   edits a gym format
// /admin/format?org=..&from=<key>|blank    starts a new one from a copy or blank
export default function FormatPage() {
  const { org, id, from } = useLocalSearchParams<{ org: string; id?: string; from?: string }>();
  const [t, setT] = useState<RaceTemplate | null>(from === 'blank' ? blankTemplate() : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (from === 'blank') return;
    let alive = true;
    loadFormats(org).then(
      (list) => {
        if (!alive) return;
        const found = list.find((f) => f.key === (id ?? from));
        if (!found) setError('That format was not found.');
        else setT(id ? found.template : cloneTemplate(found.template, `${found.template.name} copy`));
      },
      (e: AdminError) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [org, id, from]);

  if (!t) {
    return <Screen status={false}>{error ? <Notice>{error}</Notice> : <ActivityIndicator size="large" color={C.text} />}</Screen>;
  }

  const problems = validateTemplate(t);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveFormat(org, tidyTemplate(t), id ?? null);
      router.back();
    } catch (e) {
      setError((e as AdminError).message);
      setBusy(false);
    }
  };

  return (
    <Screen status={false}>
      <H1>{id ? 'Edit format' : 'New format'}</H1>
      <FormatEditor value={t} onChange={setT} />
      {error ? <Notice>{error}</Notice> : null}
      <Btn label={busy ? 'Saving' : 'Save format'} big disabled={busy || problems.length > 0} onPress={save} />
      {id ? (
        <Btn
          label="Delete this format"
          kind="stop"
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await deleteFormat(org, id);
              router.back();
            } catch (e) {
              setError((e as AdminError).message);
              setBusy(false);
            }
          }}
        />
      ) : null}
    </Screen>
  );
}
