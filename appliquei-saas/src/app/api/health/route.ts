import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ 
    message: 'Appliquei SaaS API está rodando!',
    version: '1.0.0',
    status: 'healthy'
  });
}
