import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/**
 * Inline stroke icon set. Deliberately dependency-free: no icon library is
 * bundled, keeping the payload small while giving the public site a consistent
 * visual language.
 */
function Icon({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </Icon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  );
}

export function CaretDownIcon(props: IconProps) {
  return (
    <Icon size={16} {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12h16m-6-6 6 6-6 6" />
    </Icon>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12H4m6 6-6-6 6-6" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 15V3m0 0L7 8m5-5 5 5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Icon>
  );
}

export function MessageCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 11.5a8.38 8.38 0 0 1-9 8.35 8.5 8.5 0 0 1-3.4-.7L3 21l1.85-5.6A8.38 8.38 0 0 1 3.65 11.5a8.5 8.5 0 0 1 8.35-9 8.5 8.5 0 0 1 9 9Z" />
    </Icon>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </Icon>
  );
}

export function PillIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="9" width="18" height="7" rx="3.5" transform="rotate(-45 12 12.5)" />
      <path d="M8.6 15.4 15.4 8.6" />
    </Icon>
  );
}

export function ShieldHeartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3 5 5.6v5.2c0 4.6 3 8.4 7 9.6 4-1.2 7-5 7-9.6V5.6Z" />
      <path d="M12 13.4s-2.4-1.5-2.4-3.2c0-.9.7-1.6 1.6-1.6.5 0 .8.2.8.2s.3-.2.8-.2c.9 0 1.6.7 1.6 1.6 0 1.7-2.4 3.2-2.4 3.2Z" />
    </Icon>
  );
}

export function StethoscopeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 3v5a4 4 0 0 0 8 0V3" />
      <path d="M9 12v3a5 5 0 0 0 10 0v-2" />
      <circle cx="19" cy="10" r="2" />
    </Icon>
  );
}

export function FlaskIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 3h5" />
      <path d="M10 3v5.2L5.6 17a2.4 2.4 0 0 0 2.1 3.5h8.6a2.4 2.4 0 0 0 2.1-3.5L14 8.2V3" />
      <path d="M7.4 14.5h9.2" />
    </Icon>
  );
}

export function JourneyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="5" r="2.2" />
      <circle cx="18" cy="12" r="2.2" />
      <circle cx="8" cy="19" r="2.2" />
      <path d="M8 6.2 15.9 10.9M16 13.8 9.9 17.6" />
    </Icon>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z" />
      <path d="M4 5.5v15" />
      <path d="M8 7.5h8M8 11h8" />
    </Icon>
  );
}

export function SupportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M5.6 5.6 9.4 9.4m5.2 5.2 3.8 3.8m0-12.8-3.8 3.8m-5.2 5.2-3.8 3.8" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function CartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
      <path d="M3 4h2.4l2.2 11.2a1.6 1.6 0 0 0 1.6 1.3h7.9a1.6 1.6 0 0 0 1.6-1.2L20.6 8H6.1" />
    </Icon>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Icon>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Icon>
  );
}

export function TruckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7a1 1 0 0 1 1-1h9v10H4a1 1 0 0 1-1-1Z" />
      <path d="M13 10h4.2a2 2 0 0 1 1.7 1l1.8 3v2h-3" />
      <circle cx="7.5" cy="18" r="1.8" />
      <circle cx="16.5" cy="18" r="1.8" />
    </Icon>
  );
}

export function ThermometerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 4.5a2 2 0 1 1 4 0v8.7a4.5 4.5 0 1 1-4 0Z" />
      <path d="M12 9v6" />
    </Icon>
  );
}

export function RxIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 20V5h4.5a3.5 3.5 0 0 1 0 7H6" />
      <path d="m10 12 6 8" />
      <path d="m16 12-6 8" transform="translate(1.5 0)" />
    </Icon>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4 11 8-7 8 7" />
      <path d="M6 9.5V20h12V9.5" />
    </Icon>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M15.5 6.5a3.2 3.2 0 0 1 0 6" />
      <path d="M17 14.4a5.5 5.5 0 0 1 3.5 5.1" />
    </Icon>
  );
}

export function DocumentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 3h7l5 5v13H7Z" />
      <path d="M14 3v5h5" />
      <path d="M10 13h6M10 16.5h6" />
    </Icon>
  );
}

export function TrendUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 17.5 9.5 11l4 4L21 7.5" />
      <path d="M15 7.5h6v6" />
    </Icon>
  );
}

export function ActivityIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h4l2.5-6.5L14 18.5 16.5 12H21" />
    </Icon>
  );
}

export function ClipboardCheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3h6v1.5" />
      <path d="m9 13 2.2 2.2L15.5 11" />
    </Icon>
  );
}

export function PackageIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3 4 7v10l8 4 8-4V7Z" />
      <path d="m4 7 8 4 8-4" />
      <path d="M12 11v10" />
    </Icon>
  );
}
