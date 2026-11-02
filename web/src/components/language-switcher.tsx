import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LanguageAbbreviationMap } from '@/constants/common';
import { changeLanguageAsync, supportedLanguages } from '@/locales/config';
import { cn } from '@/lib/utils';
import { LucideChevronDown, LucideLanguages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const getLanguageLabel = (code: string, fallback?: string) =>
  LanguageAbbreviationMap[
    code as keyof typeof LanguageAbbreviationMap
  ] || fallback || code;

interface LanguageSwitcherProps {
  className?: string;
  // Only render the icon, used by compact layouts.
  compact?: boolean;
}

/**
 * Language selector shared by the login page and the app header, so that the
 * language can be switched before signing in.
 */
export function LanguageSwitcher({
  className,
  compact = false,
}: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation();
  const currentLanguage = supportedLanguages.find(
    (x) => x.code === i18n.language,
  );
  const currentLabel = getLanguageLabel(
    currentLanguage?.code || '',
    currentLanguage?.displayName,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            'size-10 shrink-0 px-0 text-text-secondary',
            !compact && 'size-auto gap-1 px-3',
            className,
          )}
          aria-label={t('common.language')}
        >
          {compact ? (
            <LucideLanguages className="size-5" />
          ) : (
            <>
              <LucideLanguages className="size-4" />
              {currentLabel}
              <LucideChevronDown className="size-[1em]" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="max-h-[60vh] overflow-auto">
        {supportedLanguages.map((x) => (
          <DropdownMenuItem
            key={x.code}
            onClick={() => changeLanguageAsync(x.code)}
            className={cn(
              x.code === currentLanguage?.code && 'font-medium text-accent-primary',
            )}
          >
            {getLanguageLabel(x.code, x.displayName)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default LanguageSwitcher;
