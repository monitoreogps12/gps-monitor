import { Link, useLocation } from "wouter";
import { LayoutDashboard, Map as MapIcon, Wrench, Users, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const [location] = useLocation();

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/reportes", label: "Reportes de Fallas", icon: AlertTriangle },
    { href: "/soporte", label: "Soporte Técnico", icon: Wrench },
    { href: "/clientes", label: "Clientes", icon: Users },
    { href: "/mapa", label: "Mapa en Vivo", icon: MapIcon },
  ];

  return (
    <div className="w-64 bg-sidebar border-r border-sidebar-border h-full flex flex-col flex-shrink-0">
      {/* Brand */}
      <div className="p-5 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-sky-500 flex items-center justify-center shadow-md flex-shrink-0">
            <MapIcon className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-tight tracking-tight">GPS SISTEMA C.A.</h1>
            <p className="text-[10px] text-sidebar-foreground/50 font-semibold uppercase tracking-[0.15em] mt-0.5">Panel de Control</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        <p className="text-[10px] font-semibold text-sidebar-foreground/30 uppercase tracking-[0.2em] px-3 pt-2 pb-1.5">Navegación</p>
        {links.map((link) => {
          const isActive = location === link.href;
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                isActive
                  ? "bg-sidebar-accent text-white shadow-sm"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
              )}
            >
              <Icon className={cn("w-4 h-4 flex-shrink-0", isActive ? "text-sky-400" : "text-sidebar-foreground/40")} />
              {link.label}
              {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-sky-400" />}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="text-[10px] text-sidebar-foreground/30 text-center font-medium tracking-wider uppercase">
          GPS Admin v1.0
        </div>
      </div>
    </div>
  );
}
