import { NextResponse } from 'next/server';
import { getProducts, createProduct } from '@/actions/products';

export async function GET() {
  try {
    const list = await getProducts();
    return NextResponse.json(list, { status: 200 });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, slug, description } = body;
    
    if (!name || !slug) {
      return NextResponse.json({ error: 'Name and Slug are required' }, { status: 400 });
    }

    const created = await createProduct({ name, slug, description });
    return NextResponse.json(created, { status: 201 });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 400 });
  }
}
