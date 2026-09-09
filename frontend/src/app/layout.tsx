import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'GRUPOGEO ERP | Plataforma Corporativa',
  description: 'Plataforma corporativa integrada do Grupo Geo',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
