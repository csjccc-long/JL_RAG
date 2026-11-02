import { ParseDocumentType } from '@/components/layout-recognize-form-field';
import {
  ModelTreeSelectFormField,
  ModelTypeMap,
} from '@/components/model-tree-select';
import { isGoBackend } from '@/utils/backend-runtime';
import { isEmpty } from 'lodash';
import { useEffect, useMemo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useOwnerTenantId } from '../../context';
import {
  FlattenMediaToTextFormField,
  LanguageFormField,
  ParserMethodFormField,
  RemoveHeaderFooterFormField,
  RmdirFormField,
  TwoColumnCheckFormField,
} from './common-form-fields';
import { CommonProps } from './interface';
import { DynamicPageRange } from './dynamic-page-range';
import { useSetInitialLanguage } from './use-set-initial-language';
import { buildFieldNameWithPrefix } from './utils';

export function PdfFormFields({ prefix }: CommonProps) {
  const { t } = useTranslation();
  const form = useFormContext();
  const ownerTenantId = useOwnerTenantId();

  const parseMethodName = buildFieldNameWithPrefix('parse_method', prefix);
  const parseMethod = useWatch({
    name: parseMethodName,
  });
  const flattenMediaToText = useWatch({
    name: buildFieldNameWithPrefix('flatten_media_to_text', prefix),
  });

  const languageShown = useMemo(() => {
    return (
      !isEmpty(parseMethod) &&
      parseMethod !== ParseDocumentType.DeepDOC &&
      parseMethod !== ParseDocumentType.PlainText
    );
  }, [parseMethod]);

  useSetInitialLanguage({ prefix, languageShown });

  useEffect(() => {
    if (isEmpty(form.getValues(parseMethodName))) {
      form.setValue(parseMethodName, ParseDocumentType.DeepDOC, {
        shouldValidate: true,
        shouldDirty: true,
      });
    }
  }, [form, parseMethodName]);

  return (
    <>
      <TwoColumnCheckFormField prefix={prefix} />
      <RmdirFormField prefix={prefix} />
      <RemoveHeaderFooterFormField prefix={prefix} />
      <ParserMethodFormField prefix={prefix}></ParserMethodFormField>
      {isGoBackend() && <DynamicPageRange prefix={prefix} />}
      <FlattenMediaToTextFormField prefix={prefix} />
      {!flattenMediaToText && (
        <ModelTreeSelectFormField
          name={buildFieldNameWithPrefix('vlm.llm_id', prefix)}
          label={t('chat.model')}
          modelTypes={ModelTypeMap.img2txt_id}
          allowClear
          ownerTenantId={ownerTenantId}
        />
      )}
      {languageShown && <LanguageFormField prefix={prefix}></LanguageFormField>}
    </>
  );
}
