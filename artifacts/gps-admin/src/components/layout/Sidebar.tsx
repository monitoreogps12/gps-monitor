import { Link, useLocation } from "wouter";
import { LayoutDashboard, Map as MapIcon, Wrench, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const [location] = useLocation();

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/soporte", label: "Soporte Técnico", icon: Wrench },
    { href: "/clientes", label: "Clientes", icon: Users },
    { href: "/mapa", label: "Mapa en Vivo", icon: MapIcon },
  ];

  return (
    <div className="w-64 bg-sidebar border-r border-sidebar-border h-full flex flex-col flex-shrink-0">
      <div className="p-6 border-b border-sidebar-border">
        <h1 className="text-xl font-bold text-sidebar-primary tracking-tight">GPS SISTEMA C.A.</h1>
        <p className="text-xs text-sidebar-foreground/50 mt-1 uppercase tracking-wider font-semibold">Panel de Control</p>
      </div>
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {links.map((link) => {
          const isActive = location === link.href;
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive 
                  ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Icon className={cn("w-4 h-4", isActive ? "text-sidebar-primary" : "text-sidebar-foreground/50")} />
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-sidebar-border text-xs text-sidebar-foreground/40 text-center">
        GPS Admin v1.0.0
      </div>
    </div>
  );
}
