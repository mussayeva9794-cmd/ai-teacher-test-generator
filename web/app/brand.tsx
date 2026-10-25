import Link from "next/link";

export const BRAND_NAME = "Mugalim AI";

/** The product mark used in every header. */
export function Brand({ onClick, compact = false }: { onClick?: (event: React.MouseEvent) => void; compact?: boolean }) {
  return <Link className="brand" href="/" onClick={onClick}>
    <span className="brand-mark" aria-hidden="true">M</span>
    {compact ? <span className="brand-text">{BRAND_NAME}</span> : BRAND_NAME}
  </Link>;
}
