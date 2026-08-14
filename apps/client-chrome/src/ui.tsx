import { forwardRef, type ComponentPropsWithoutRef } from 'react'

type DivProps = ComponentPropsWithoutRef<'div'>
type SpanProps = ComponentPropsWithoutRef<'span'>
type HeadingProps = ComponentPropsWithoutRef<'h2'>
type CodeProps = ComponentPropsWithoutRef<'code'>
type ParagraphProps = ComponentPropsWithoutRef<'p'>
type ButtonProps = ComponentPropsWithoutRef<'button'>
type InputProps = ComponentPropsWithoutRef<'input'>
type SelectProps = ComponentPropsWithoutRef<'select'>

export function Root(props: DivProps) {
  return <div {...props} />
}

export function Badge(props: SpanProps) {
  return <span {...props} />
}

export function Card(props: DivProps) {
  return <div {...props} />
}

export function Heading(props: HeadingProps) {
  return <h2 {...props} />
}

export function Mono(props: CodeProps) {
  return <code {...props} />
}

export function Text(props: ParagraphProps) {
  return <p {...props} />
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  return <button ref={ref} {...props} />
})

export const IconButton = Button

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(props, ref) {
  return <input ref={ref} {...props} />
})

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(props, ref) {
  return <select ref={ref} {...props} />
})
