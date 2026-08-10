import { NextRequest, NextResponse } from 'next/server';
import { getMonthlyRepairs, upsertRepair, deleteRepair } from '@/lib/db';

export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get('month');
  if (!month) {
    return NextResponse.json({ error: 'month param required' }, { status: 400 });
  }
  const repairs = await getMonthlyRepairs(month);
  return NextResponse.json({ repairs });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  await upsertRepair(body);
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id param required' }, { status: 400 });
  }
  await deleteRepair(id);
  return NextResponse.json({ success: true });
}
