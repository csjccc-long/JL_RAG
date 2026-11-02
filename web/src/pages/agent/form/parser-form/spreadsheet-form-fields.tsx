import { ParseDocumentType } from '@/components/layout-recognize-form-field';
import {
  ModelTreeSelectFormField,
  ModelTypeMap,
} from '@/components/model-tree-select';
import { isEmpty } from 'lodash';
import { useEffect } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useOwnerTenantId } from '../../context';
import {
  FlattenMediaToTextFormField,
  ParserMethodFormField,
} from './common-form-fields';
import { CommonProps } from './interface';
import { buildFieldNameWithPrefix } from './utils';

export function SpreadsheetFormFields({ prefix }: CommonProps) {
  const { t } = useTranslation();
  const form = useFormContext();
  const ownerTenantId = useOwnerTenantId();

  const parseMethodName = buildFieldNameWithPrefix('parse_method', prefix);

  const flattenMediaToText = useWatch({
    name: buildFieldNameWithPrefix('flatten_media_to_text', prefix),
  });

  const optionsWithoutLLM = [
    { label: ParseDocumentType.DeepDOC, value: ParseDocumentType.DeepDOC },
  ];

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
      <ParserMethodFormField
        prefix={prefix}
        optionsWithoutLLM={optionsWithoutLLM}
      ></ParserMethodFormField>
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
    </>
  );
}
