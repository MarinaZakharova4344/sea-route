import Link from "next/link";
import BrandIcon from "./BrandIcon";
import ConnectionBanner from "@/components/pwa/ConnectionBanner";
import InstallButton from "@/components/pwa/InstallButton";
import { HeaderNav, TabBar, type NavItem } from "./nav";
import LogoutButton from "@/components/layout/LogoutButton";

export default function AppHeader({
  userName,
  roleLabel,
  home,
  nav,
}: {
  userName: string;
  roleLabel: string;
  home: string;
  nav: NavItem[];
}) {
  return (
    <>
      <header className="topbar">
        <div className="topbar__inner">
          <Link href={home} className="topbar__brand">
            <BrandIcon className="topbar__icon" />
            <span>
              <span className="topbar__name">Морской маршрут</span>
              <span className="topbar__tag">Контейнерные перевозки</span>
            </span>
          </Link>
          <HeaderNav items={nav} />
          <span className="topbar__spacer" />
          <div className="topbar__user">
            <span className="topbar__who">
              <strong>{userName}</strong>
              <small>{roleLabel}</small>
            </span>
            <InstallButton />
            <LogoutButton />
          </div>
        </div>
      </header>
      <ConnectionBanner renderedAt={new Date().toISOString()} />
      <TabBar items={nav} />
    </>
  );
}
