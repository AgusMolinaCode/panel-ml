import { NextRequest, NextResponse } from 'next/server';
import { deleteMonthlyExpense } from '@/lib/db';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await deleteMonthlyExpense(id);
  return NextResponse.json({ success: true });
}
