import { IFile } from '@/interfaces/database/file-manager';

export function isFolderType(type: string) {
  return type === 'folder';
}

export function isKnowledgeBaseType(sourceType: string) {
  return sourceType === 'knowledgebase';
}

export function isSkillsFolder(file: IFile) {
  return isFolderType(file.type) && file.name.toLowerCase() === 'skills';
}

/**
 * The order every view of the file manager shows: the skills entry first,
 * then newest first. When the skills feature is off, its folder is hidden and
 * the caller must subtract `hiddenCount` from the server-side total.
 */
export function sortFileList(files: IFile[], skillsEnabled: boolean) {
  const visibleFiles = skillsEnabled
    ? files
    : files.filter((file) => !isSkillsFolder(file));

  const sortedFiles = [...visibleFiles].sort((a, b) => {
    const aIsSkills = isSkillsFolder(a);
    const bIsSkills = isSkillsFolder(b);

    if (aIsSkills && !bIsSkills) return -1;
    if (!aIsSkills && bIsSkills) return 1;

    return (b.create_time || 0) - (a.create_time || 0);
  });

  return { files: sortedFiles, hiddenCount: files.length - visibleFiles.length };
}
